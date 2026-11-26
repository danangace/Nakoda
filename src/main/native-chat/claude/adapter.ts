import { tmpdir } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeEnv } from '../../accounts/env'
import type { ModelOption } from '../../../shared/schemas'
import type { AgentAdapter, CompleteOptions, Turn, TurnOptions } from '../types'
import { readClaudeHistory } from './history'
import { withIdleSession } from './idle-session'
import { type SdkLike, mapClaudeMessage } from './map'

/**
 * Claude via the Agent SDK, exactly as proven in Spike - Login: the account's CLAUDE_CONFIG_DIR,
 * API-key variables stripped (subscription login), explicit permission mode, every permission
 * request routed through `onToolRequest`. This is the only file that imports the SDK.
 */
export const claudeAdapter: AgentAdapter = {
  agent: 'claude',
  readHistory: readClaudeHistory,
  listModels: listClaudeModels,
  complete: completeClaude,
  startTurn(options: TurnOptions): Turn {
    const abortController = new AbortController()
    const run = query({
      prompt: options.prompt,
      options: {
        cwd: options.cwd,
        env: claudeEnv(options.configDir),
        model: options.model,
        effort: options.effort ?? undefined,
        resume: options.sessionId ?? undefined,
        // Claude Code's own system prompt + the workspace facts on every turn.
        systemPrompt: { type: 'preset', preset: 'claude_code', append: options.context },
        // Explicit: otherwise the user's own settings (e.g. acceptEdits) would apply.
        permissionMode: 'default',
        abortController,
        canUseTool: async (tool, input) => {
          const answer = await options.onToolRequest({ tool, input })
          return answer === 'allow'
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'The user denied this action in Nakoda.' }
        },
      },
    })

    const done = (async () => {
      try {
        for await (const message of run) {
          for (const event of mapClaudeMessage(message as unknown as SdkLike)) options.onEvent(event)
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          options.onEvent({ type: 'turn.done', ok: false, numTurns: 0 })
          return
        }
        const text = (error as Error).message
        options.onEvent({ type: 'error', kind: /logged in|login|auth/i.test(text) ? 'auth' : 'other', message: text })
        options.onEvent({ type: 'turn.done', ok: false, numTurns: 0 })
      }
    })()

    return { stop: () => abortController.abort(), done }
  },
}

/**
 * One answer to one prompt, for a login. Everything that could reach beyond the text is off: no built-in
 * tools (and any request is denied anyway), no user or project settings, no MCP servers, nothing saved
 * to the login's history, a single turn, from an empty temp folder.
 */
export async function completeClaude(options: CompleteOptions): Promise<string> {
  const abortController = new AbortController()
  options.signal?.addEventListener('abort', () => abortController.abort(), { once: true })
  const run = query({
    prompt: options.prompt,
    options: {
      cwd: tmpdir(),
      env: claudeEnv(options.configDir),
      model: options.model,
      effort: options.effort ?? undefined,
      systemPrompt: options.system,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      maxTurns: 1,
      permissionMode: 'default',
      abortController,
      canUseTool: async () => ({ behavior: 'deny', message: 'A draft uses no tools.' }),
    },
  })
  for await (const message of run) {
    if (message.type !== 'result') continue
    if (message.subtype === 'success') return message.result
    throw new Error(`Claude did not finish the answer (${message.subtype}).`)
  }
  throw new Error('Claude ended without an answer.')
}

/**
 * The models a login may use, straight from Claude Code (`supportedModels()`). Nothing is billed;
 * the idle session is closed as soon as the list arrives (about 4 s).
 */
export async function listClaudeModels(configDir: string): Promise<ModelOption[]> {
  return withIdleSession(configDir, async (session) => {
    const models = await session.supportedModels()
    return models.map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description ?? '',
      resolvedModel: m.resolvedModel ?? null,
      efforts: m.supportedEffortLevels ?? [],
    }))
  })
}
