import { describe, expect, it, vi } from 'vitest'

const captured: { prompt?: string; options?: Record<string, unknown> }[] = []
let messages: unknown[] = []

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: string; options: Record<string, unknown> }) => {
    captured.push(args)
    return (async function* () {
      for (const m of messages) yield m
    })()
  },
}))

const { completeClaude } = await import('./adapter')

const ask = () => completeClaude({ configDir: '/acc', model: 'sonnet', effort: 'medium', system: 'SYS', prompt: 'PROMPT' })

describe('completeClaude', () => {
  it('gives back the answer and asks with nothing that could reach beyond the text', async () => {
    messages = [{ type: 'assistant' }, { type: 'result', subtype: 'success', result: '- [FE] Do it (2)' }]
    expect(await ask()).toBe('- [FE] Do it (2)')
    const { prompt, options } = captured.at(-1) ?? {}
    expect(prompt).toBe('PROMPT')
    expect(options).toMatchObject({
      systemPrompt: 'SYS',
      model: 'sonnet',
      effort: 'medium',
      // No built-in tools, no user or project settings, no MCP, nothing saved, one turn.
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      maxTurns: 1,
    })
    expect(options?.mcpServers).toBeUndefined()
    const canUseTool = options?.canUseTool as (tool: string, input: unknown) => Promise<{ behavior: string }>
    expect((await canUseTool('Bash', {})).behavior).toBe('deny')
  })

  it('runs from an empty temp folder with the login of the account and no API-key variables', async () => {
    messages = [{ type: 'result', subtype: 'success', result: 'ok' }]
    process.env.ANTHROPIC_API_KEY = 'k'
    await ask()
    delete process.env.ANTHROPIC_API_KEY
    const { options } = captured.at(-1) ?? {}
    expect(String(options?.cwd)).toMatch(/tmp|var/i)
    const env = options?.env as Record<string, string>
    expect(env.CLAUDE_CONFIG_DIR).toBe('/acc')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('says so when Claude did not finish, or ended without an answer', async () => {
    messages = [{ type: 'result', subtype: 'error_max_turns' }]
    await expect(ask()).rejects.toThrow(/did not finish.*error_max_turns/)
    messages = [{ type: 'assistant' }]
    await expect(ask()).rejects.toThrow(/without an answer/)
  })
})
