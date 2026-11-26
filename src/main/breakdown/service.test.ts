import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { insertAccount } from '../accounts/service'
import { SUBTASK, STORY, ME } from '../connectors/fixtures/helix'
import type { AgentAdapter, CompleteOptions } from '../native-chat/types'
import { createApp } from '../server/app'
import { TOKEN_HEADER, localHosts } from '../server/security'
import { DEFAULT_SETTINGS, saveSettings } from '../settings/store'
import { openDb } from '../sqlite/db'
import { SKILL_PATH } from './service'

const TOKEN = `sidpjm_${'a'.repeat(64)}`
const sessionToken = 'a'.repeat(64)
const headers = { host: '127.0.0.1:4317', [TOKEN_HEADER]: sessionToken, 'content-type': 'application/json' }
const SPEC = 'frontend/modules/i-15/invoices/FE-01 Invoices.md'
const OQ_TABLE = '| OQ | Topic | Owner | Blocks coding | Status |\n|---|---|---|---|---|\n| OQ-01 | Cards | PM | no | **decided** 2026-11-07 |\n| OQ-02 | Copy | PM | yes | open |\n'

function setup(opts: { answer?: string | Error; withSkill?: boolean; withAccount?: boolean; story?: Record<string, unknown> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nakoda-bd-'))
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  put(SPEC, '# FE-01\n\nAC-1: the list shows invoices.\nAC-2: search by number.\n')
  put('frontend/modules/i-15/invoices/Open Questions.md', `# OQ\n\n${OQ_TABLE}`)
  put('frontend/modules/i-15/lonely/FE-01 Lonely.md', '# Lonely\n')
  if (opts.withSkill) put(SKILL_PATH, '---\nname: x\n---\nVAULT RULES MARKER\n')
  const db = openDb(':memory:')
  saveSettings(db, { ...DEFAULT_SETTINGS, docsRoot: root })
  if (opts.withAccount !== false) insertAccount(db, { agent: 'claude', label: 'sid', kind: 'attached', configDir: '/acc-dir' })
  const calls: CompleteOptions[] = []
  const adapter: AgentAdapter = {
    agent: 'claude',
    startTurn: () => {
      throw new Error('a draft never starts a chat turn')
    },
    complete: async (o) => {
      calls.push(o)
      const a = opts.answer ?? '- [BE] Add paged invoice endpoint (2)\n- [FE] Show invoice list (3)\nNote: AC-2 has no contract'
      if (a instanceof Error) throw a
      return a
    },
  }
  const story = { data: { ...STORY.data, status: 'in_progress', ...opts.story } }
  const fakeFetch = (async (url: string | URL | Request) => {
    const p = new URL(String(url)).pathname
    const body = p === '/api/auth/me' ? ME : p === '/api/tickets/T2-3252' ? story : p === '/api/tickets/T2-3274' ? SUBTASK : null
    return new Response(JSON.stringify(body ?? { error: 'nope' }), { status: body ? 200 : 404 })
  }) as typeof fetch
  const app = createApp({ security: { token: sessionToken, allowedHosts: localHosts(4317) }, db, connectors: { secretsDir: root, fetch: fakeFetch, env: {} }, breakdownAdapters: { claude: adapter } })
  const call = (method: string, path: string, body?: unknown) => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const connect = async () => ((await (await call('POST', '/api/connectors', { label: 'Helix', baseUrl: 'https://helix.test', token: TOKEN })).json()) as { id: string }).id
  return { call, connect, calls }
}

const draft = (call: ReturnType<typeof setup>['call'], connectorId: string, extra: Record<string, unknown> = {}) =>
  call('POST', '/api/breakdown/draft', { connectorId, key: 'T2-3252', docPath: SPEC, ...extra })

describe('is the spec ready', () => {
  it('reads the Open Questions file next to it: how many, and which are still open', async () => {
    const { call } = setup()
    const res = await call('GET', `/api/breakdown/spec-check?path=${encodeURIComponent(SPEC)}`)
    expect(await res.json()).toEqual({ questionsPath: 'frontend/modules/i-15/invoices/Open Questions.md', total: 2, open: [{ id: 'OQ-02', topic: 'Copy', blocksCoding: true }] })
  })

  it('says there is no Open Questions file when the folder has none, and needs a path', async () => {
    const { call } = setup()
    expect(await (await call('GET', `/api/breakdown/spec-check?path=${encodeURIComponent('frontend/modules/i-15/lonely/FE-01 Lonely.md')}`)).json()).toEqual({ questionsPath: null, total: 0, open: [] })
    expect((await call('GET', '/api/breakdown/spec-check')).status).toBe(400)
  })
})

describe('draft with Claude', () => {
  it('sends the spec, the ticket and its existing subtasks, and returns a clean list', async () => {
    const { call, connect, calls } = setup()
    const res = await draft(call, await connect(), { hint: 'The API already exists' })
    expect(await res.json()).toEqual({
      text: '- [BE] Add paged invoice endpoint (2)\n- [FE] Show invoice list (3)\nNote: AC-2 has no contract',
      notes: ['AC-2 has no contract'],
      count: 2,
      truncated: false,
      model: 'sonnet',
      account: 'sid',
      rules: 'built-in',
    })
    expect(calls).toHaveLength(1)
    const sent = calls[0]
    expect(sent?.configDir).toBe('/acc-dir')
    expect(sent?.system).toContain('2 to 6 subtasks')
    expect(sent?.prompt).toContain('AC-2: search by number.')
    expect(sent?.prompt).toContain('Invoice Management - Phase 1')
    expect(sent?.prompt).toContain('T2-3275 [open] [BE] Invoice export')
    // A defect child is not an existing subtask; an archived one is not listed either.
    expect(sent?.prompt).not.toContain('Total ignores discount')
    expect(sent?.prompt).toContain('The API already exists')
  })

  it('uses the rules from the vault skill when it is in the docs root', async () => {
    const { call, connect, calls } = setup({ withSkill: true })
    expect(await (await draft(call, await connect())).json()).toMatchObject({ rules: 'vault' })
    expect(calls[0]?.system).toContain('VAULT RULES MARKER')
    expect(calls[0]?.system).not.toContain('name: x')
  })

  it('refuses before calling Claude: no account, a parent that cannot take subtasks, a done parent, a missing or non-markdown doc', async () => {
    const none = setup({ withAccount: false })
    const idNone = await none.connect()
    expect(await (await draft(none.call, idNone)).json()).toMatchObject({ error: 'no_account' })

    const sub = setup()
    expect(await (await draft(sub.call, await sub.connect(), { key: 'T2-3274' })).json()).toMatchObject({ error: 'parent_cannot_have_subtasks' })

    const done = setup({ story: { status: 'done' } })
    expect(await (await draft(done.call, await done.connect())).json()).toMatchObject({ error: 'parent_done' })

    const s = setup()
    const id = await s.connect()
    expect((await draft(s.call, id, { docPath: 'nope/missing.md' })).status).toBe(404)
    expect((await draft(s.call, id, { docPath: '../../etc/passwd' })).status).toBe(400)
    expect((await draft(s.call, id, { docPath: 'frontend/notes.txt' })).status).toBe(400)
    expect(none.calls.length + sub.calls.length + done.calls.length + s.calls.length).toBe(0)
  })

  it('says why when Claude fails, is logged out, or answers without a list', async () => {
    const a = setup({ answer: new Error('Not logged in · Please run /login') })
    expect(await (await draft(a.call, await a.connect())).json()).toMatchObject({ error: 'draft_auth' })
    const b = setup({ answer: new Error('overloaded') })
    expect(await (await draft(b.call, await b.connect())).json()).toMatchObject({ error: 'draft_failed', message: expect.stringContaining('overloaded') })
    const c = setup({ answer: 'I need the full spec first.' })
    expect(await (await draft(c.call, await c.connect())).json()).toMatchObject({ error: 'draft_empty', message: expect.stringContaining('I need the full spec first') })
  })
})

describe('one document per ticket', () => {
  it('remembers the document and adds up what was created from it; another document starts over', async () => {
    const { call, connect } = setup()
    const connectorId = await connect()
    const q = `connectorId=${connectorId}&key=T2-3252`
    expect(await (await call('GET', `/api/breakdown/source?${q}`)).json()).toBeNull()
    await call('PUT', '/api/breakdown/source', { connectorId, key: 'T2-3252', docPath: SPEC, created: 3 })
    const again = await (await call('PUT', '/api/breakdown/source', { connectorId, key: 'T2-3252', docPath: SPEC, created: 2 })).json()
    expect(again).toMatchObject({ docPath: SPEC, created: 5 })
    expect(await (await call('GET', `/api/breakdown/source?${q}`)).json()).toMatchObject({ docPath: SPEC, created: 5 })
    const other = await (await call('PUT', '/api/breakdown/source', { connectorId, key: 'T2-3252', docPath: 'frontend/modules/i-15/lonely/FE-01 Lonely.md', created: 1 })).json()
    expect(other).toMatchObject({ created: 1 })
  })

  it('rejects a malformed source', async () => {
    const { call } = setup()
    expect((await call('PUT', '/api/breakdown/source', { connectorId: 'c', key: 'k', docPath: 'd.md', created: -1 })).status).toBe(400)
    expect((await call('GET', '/api/breakdown/source')).status).toBe(400)
  })
})
