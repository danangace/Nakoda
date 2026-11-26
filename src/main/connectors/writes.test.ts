import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../server/app'
import { TOKEN_HEADER, localHosts } from '../server/security'
import { openDb } from '../sqlite/db'
import { BOARDS, ME } from './fixtures/helix'

const READ = `sidpjm_${'a'.repeat(64)}`
const WRITE = `sidpjm_${'b'.repeat(64)}`
const sessionToken = 'a'.repeat(64)
const headers = { host: '127.0.0.1:4317', [TOKEN_HEADER]: sessionToken, 'content-type': 'application/json' }
const AUTHOR = { data: { ...ME.data, token: { scope: 'ticket_authoring', capabilities: ['read', 'create', 'write'], expires_at: '2027-09-22T00:00:00Z' } } }

type Seen = { method: string; path: string; auth: string | null; body: Record<string, unknown> | null }

function setup(opts: { env?: NodeJS.ProcessEnv; answer?: (seen: Seen) => Response | undefined } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nakoda-write-'))
  const seen: Seen[] = []
  let created = 0
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const auth = ((init?.headers ?? {}) as Record<string, string>).Authorization ?? null
    const call: Seen = { method: init?.method ?? 'GET', path: u.pathname, auth, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null }
    seen.push(call)
    const custom = opts.answer?.(call)
    if (custom) return custom
    if (u.pathname === '/api/auth/me') return new Response(JSON.stringify(auth === `Bearer ${WRITE}` ? AUTHOR : ME), { status: 200 })
    if (u.pathname === '/api/boards/') return new Response(JSON.stringify(BOARDS), { status: 200 })
    if (call.method === 'PATCH' && u.pathname.endsWith('/status')) return new Response(JSON.stringify({ data: { status: call.body?.status } }), { status: 200 })
    if (call.method === 'POST' && u.pathname.endsWith('/comments')) return new Response(JSON.stringify({ data: { id: 1 } }), { status: 201 })
    if (call.method === 'POST' && u.pathname.endsWith('/children')) return new Response(JSON.stringify({ data: { ticket_key: `T2-${100 + ++created}` } }), { status: 201 })
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  const db = openDb(':memory:')
  const app = createApp({ security: { token: sessionToken, allowedHosts: localHosts(4317) }, db, connectors: { secretsDir: dir, fetch: fakeFetch, env: opts.env ?? {} } })
  const call = (method: string, path: string, body?: unknown) => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const connect = async (extra: Record<string, unknown> = {}) => {
    const res = await call('POST', '/api/connectors', { label: 'Helix', baseUrl: 'https://helix.test', token: READ, ...extra })
    return (await res.json()) as { id: string } & Record<string, unknown>
  }
  const writesOf = (): Seen[] => seen.filter((s) => s.method !== 'GET')
  return { call, connect, seen, writesOf, dir, db }
}

describe('a write token on a connection', () => {
  it('is optional: a read-only connection cannot change anything', async () => {
    const { call, connect, writesOf } = setup()
    const c = await connect()
    expect(c).toMatchObject({ writeTokenSource: null, writeTokenHint: null })
    const action = { action: 'comment', key: 'T2-9', content: 'hi' }
    expect(await (await call('POST', `/api/connectors/${c.id}/writes/preview`, action)).json()).toMatchObject({ error: 'write_token_missing' })
    const res = await call('POST', `/api/connectors/${c.id}/writes`, { ...action, confirmed: true })
    expect(res.status).toBe(400)
    expect(writesOf()).toHaveLength(0)
  })

  it('is saved apart from the read token, shown only as a hint, and survives a change of the read token', async () => {
    const { call, connect, dir } = setup()
    const c = await connect({ writeToken: WRITE })
    expect(c).toMatchObject({ writeTokenSource: { kind: 'stored' }, writeTokenHint: 'sidpjm_…bbbb', tokenHint: 'sidpjm_…aaaa' })
    expect(JSON.stringify(c)).not.toContain(WRITE)
    const next = `sidpjm_${'d'.repeat(64)}`
    await call('PATCH', `/api/connectors/${c.id}`, { label: 'Helix', baseUrl: 'https://helix.test', token: next })
    const saved = JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')) as { connections: Record<string, { token?: string; writeToken?: string }> }
    expect(saved.connections[c.id]).toEqual({ token: next, writeToken: WRITE })
  })

  it('can be removed on its own', async () => {
    const { call, connect, dir } = setup()
    const c = await connect({ writeToken: WRITE })
    const res = await call('PATCH', `/api/connectors/${c.id}`, { label: 'Helix', baseUrl: 'https://helix.test', clearWrite: true })
    expect(await res.json()).toMatchObject({ writeTokenSource: null, writeTokenHint: null })
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain(WRITE)
  })

  it('may come from the author variable, which a read source still may not', async () => {
    const env = { SIDPJM_PAT_READ_TICKET: READ, SIDPJM_PAT_AUTHOR_TICKET: WRITE }
    const { call, connect } = setup({ env })
    expect(await (await call('GET', '/api/connectors/env-vars')).json()).toEqual(['SIDPJM_PAT_READ_TICKET'])
    expect(await (await call('GET', '/api/connectors/env-vars?for=write')).json()).toEqual(['SIDPJM_PAT_AUTHOR_TICKET', 'SIDPJM_PAT_READ_TICKET'])
    expect((await call('POST', '/api/connectors', { label: 'H', baseUrl: 'https://helix.test', envName: 'SIDPJM_PAT_AUTHOR_TICKET' })).status).toBe(400)
    const c = await connect({ writeEnvName: 'SIDPJM_PAT_AUTHOR_TICKET' })
    expect(c).toMatchObject({ writeTokenSource: { kind: 'env', name: 'SIDPJM_PAT_AUTHOR_TICKET' }, writeTokenHint: 'sidpjm_…bbbb' })
  })

  it('refuses both a pasted token and a variable, a malformed token, and a variable that is not set', async () => {
    const { call } = setup({ env: { SIDPJM_PAT_AUTHOR_TICKET: WRITE } })
    const base = { label: 'H', baseUrl: 'https://helix.test', token: READ }
    expect((await call('POST', '/api/connectors', { ...base, writeToken: WRITE, writeEnvName: 'SIDPJM_PAT_AUTHOR_TICKET' })).status).toBe(400)
    expect((await call('POST', '/api/connectors', { ...base, writeToken: 'nope' })).status).toBe(400)
    expect((await call('POST', '/api/connectors', { ...base, writeEnvName: 'SIDPJM_NOT_SET' })).status).toBe(400)
    expect((await call('POST', '/api/connectors', { ...base, writeEnvName: 'AWS_SECRET_ACCESS_KEY' })).status).toBe(400)
  })

  it('is tested on its own: it must read, create and write', async () => {
    const { call, connect } = setup()
    const good = await connect({ writeToken: WRITE })
    expect(await (await call('POST', `/api/connectors/${good.id}/test-write`)).json()).toMatchObject({ scope: 'ticket_authoring', warnings: [] })
    // A "write" token that is really the read token.
    const weak = await call('POST', '/api/connectors', { label: 'H2', baseUrl: 'https://helix.test', token: READ, writeToken: `sidpjm_${'e'.repeat(64)}` })
    const id = ((await weak.json()) as { id: string }).id
    expect(((await (await call('POST', `/api/connectors/${id}/test-write`)).json()) as { warnings: string[] }).warnings.length).toBeGreaterThan(0)
  })
})

describe('changing a ticket', () => {
  it('previews exactly what would be sent, and sends nothing', async () => {
    const { call, connect, writesOf } = setup()
    const c = await connect({ writeToken: WRITE })
    const preview = await (await call('POST', `/api/connectors/${c.id}/writes/preview`, { action: 'status', key: 'T2-9', status: 'in_review', comment: 'PR opened' })).json()
    expect(preview).toMatchObject({
      summary: 'Move T2-9 to in_review with a note',
      requests: [{ method: 'PATCH', path: '/api/tickets/T2-9/status', body: { status: 'in_review', comment: 'PR opened' } }],
    })
    expect(writesOf()).toHaveLength(0)
  })

  it('warns about email: an @mention, and a subtask given to someone else', async () => {
    const { call, connect } = setup()
    const c = await connect({ writeToken: WRITE })
    const mention = (await (await call('POST', `/api/connectors/${c.id}/writes/preview`, { action: 'comment', key: 'T2-9', content: 'cc @budi please look' })).json()) as { notes: string[] }
    expect(mention.notes.join(' ')).toMatch(/@mention sends that person an email/)
    const plain = (await (await call('POST', `/api/connectors/${c.id}/writes/preview`, { action: 'comment', key: 'T2-9', content: 'no one named' })).json()) as { notes: string[] }
    expect(plain.notes.join(' ')).not.toMatch(/email/)
    // The token belongs to user 7 (ME): 7 is yourself, 9 is someone else.
    const subs = (await (await call('POST', `/api/connectors/${c.id}/writes/preview`, { action: 'subtasks', parentKey: 'T2-9', items: [{ title: 'Mine', assigneeId: 7 }, { title: 'Theirs', assigneeId: 9 }] })).json()) as { notes: string[]; requests: unknown[] }
    expect(subs.requests).toHaveLength(2)
    expect(subs.notes.join(' ')).toMatch(/1 subtask is assigned to someone else/)
  })

  it('does nothing without confirmation, even for a valid action', async () => {
    const { call, connect, writesOf } = setup()
    const c = await connect({ writeToken: WRITE })
    for (const confirmed of [undefined, false, 'true', 1]) {
      const res = await call('POST', `/api/connectors/${c.id}/writes`, { action: 'comment', key: 'T2-9', content: 'hi', ...(confirmed === undefined ? {} : { confirmed }) })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'confirmation_required' })
    }
    expect(writesOf()).toHaveLength(0)
  })

  it('moves a ticket with the WRITE token (never the read one) and logs it', async () => {
    const { call, connect, writesOf } = setup()
    const c = await connect({ writeToken: WRITE })
    const res = await call('POST', `/api/connectors/${c.id}/writes`, { action: 'status', key: 'T2-9', status: 'in_review', comment: 'PR opened', confirmed: true })
    expect(await res.json()).toEqual({ ok: true, done: [{ key: 'T2-9' }], failure: null, warnings: [] })
    expect(writesOf()).toEqual([{ method: 'PATCH', path: '/api/tickets/T2-9/status', auth: `Bearer ${WRITE}`, body: { status: 'in_review', comment: 'PR opened' } }])
    const log = (await (await call('GET', `/api/connectors/${c.id}/writes`)).json()) as { action: string; ticketKey: string; ok: boolean }[]
    expect(log).toMatchObject([{ action: 'status', ticketKey: 'T2-9', ok: true }])
  })

  it('creates subtasks one by one and stops at the first refusal, reporting what was done', async () => {
    const { call, connect, writesOf } = setup({
      answer: (s) => (s.body?.title === 'Second' ? new Response(JSON.stringify({ code: 'child_arrival_blocked', error: 'The story is already done' }), { status: 400 }) : undefined),
    })
    const c = await connect({ writeToken: WRITE })
    const res = await call('POST', `/api/connectors/${c.id}/writes`, {
      action: 'subtasks',
      parentKey: 'T2-9',
      items: [{ title: 'First' }, { title: 'Second' }, { title: 'Third' }],
      confirmed: true,
    })
    expect(await res.json()).toMatchObject({
      ok: false,
      done: [{ key: 'T2-101', title: 'First' }],
      failure: { code: 'helix_child_arrival_blocked', title: 'Second', message: 'The story is already done' },
    })
    // Third was never tried.
    expect(writesOf().map((w) => w.body?.title)).toEqual(['First', 'Second'])
    const log = (await (await call('GET', `/api/connectors/${c.id}/writes`)).json()) as { ok: boolean; errorCode: string | null }[]
    expect(log.map((l) => [l.ok, l.errorCode])).toEqual([[false, 'helix_child_arrival_blocked'], [true, null]])
  })

  it('logs a refusal and keeps the token out of the log and the answers', async () => {
    const { call, connect, db } = setup({ answer: () => new Response(JSON.stringify({ code: 'session_required', details: { field: 'status' } }), { status: 403 }) })
    const c = await connect({ writeToken: WRITE })
    const res = await call('POST', `/api/connectors/${c.id}/writes`, { action: 'status', key: 'T2-9', status: 'to_do', confirmed: true })
    expect(await res.json()).toMatchObject({ ok: false, failure: { code: 'helix_human_only' } })
    const rows = JSON.stringify(db.prepare('SELECT * FROM helix_writes').all())
    expect(rows).toContain('helix_human_only')
    expect(rows).not.toContain(WRITE)
  })

  it('rejects a malformed action before any call', async () => {
    const { call, connect, writesOf } = setup()
    const c = await connect({ writeToken: WRITE })
    for (const bad of [{ action: 'delete', key: 'T2-9' }, { action: 'comment', key: 'T2-9', content: '   ' }, { action: 'status', key: '../x', status: 'done' }, { action: 'subtasks', parentKey: 'T2-9', items: [] }, { action: 'subtasks', parentKey: 'T2-9', items: [{ title: '' }] }]) {
      expect((await call('POST', `/api/connectors/${c.id}/writes`, { ...bad, confirmed: true })).status).toBe(400)
    }
    expect(writesOf()).toHaveLength(0)
  })

  it('removing the connection removes both tokens', async () => {
    const { call, connect, dir } = setup()
    const c = await connect({ writeToken: WRITE })
    await call('DELETE', `/api/connectors/${c.id}`)
    const text = readFileSync(join(dir, 'secrets.json'), 'utf8')
    expect(text).not.toContain(WRITE)
    expect(text).not.toContain(READ)
  })
})
