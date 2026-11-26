import type { Hono } from 'hono'
import { UserError } from '../errors'
import type { ConnectorService } from './service'

const intParam = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw new UserError('invalid_query', `Invalid ${name}`)
  return n
}

export function registerConnectorRoutes(app: Hono, service: ConnectorService): void {
  const base = '/api/connectors'
  app.get(base, (c) => c.json(service.list()))
  // Names only, never values.
  app.get(`${base}/env-vars`, (c) => c.json(c.req.query('for') === 'write' ? service.writeEnvNames() : service.envNames()))
  app.post(base, async (c) => c.json(service.create(await c.req.json()), 201))
  app.patch(`${base}/:id`, async (c) => c.json(service.update(c.req.param('id'), await c.req.json())))
  app.delete(`${base}/:id`, (c) => {
    service.remove(c.req.param('id'))
    return c.json({ ok: true })
  })
  app.post(`${base}/:id/test`, async (c) => c.json(await service.test(c.req.param('id'))))
  app.post(`${base}/:id/test-write`, async (c) => c.json(await service.testWrite(c.req.param('id'))))
  // Changes to Helix: preview shows exactly what would be sent; the call needs `confirmed: true`.
  app.post(`${base}/:id/writes/preview`, async (c) => c.json(await service.previewWrite(c.req.param('id'), await c.req.json())))
  app.post(`${base}/:id/writes`, async (c) => {
    const { confirmed, ...action } = (await c.req.json()) as Record<string, unknown>
    return c.json(await service.applyWrite(c.req.param('id'), action, confirmed))
  })
  app.get(`${base}/:id/writes`, (c) => c.json(service.writes(c.req.param('id'), intParam(c.req.query('limit'), 'limit'))))
  app.get(`${base}/:id/boards/:boardId/transitions`, async (c) => c.json(await service.transitions(c.req.param('id'), intParam(c.req.param('boardId'), 'board') ?? Number.NaN)))
  app.get(`${base}/:id/boards`, async (c) => c.json(await service.boards(c.req.param('id'))))
  app.get(`${base}/:id/iterations`, async (c) => {
    const boardId = intParam(c.req.query('boardId'), 'board')
    if (boardId === undefined) throw new UserError('invalid_query', 'Pick a board first')
    return c.json(await service.iterations(c.req.param('id'), boardId))
  })
  app.get(`${base}/:id/tickets`, async (c) => {
    const q = c.req.query()
    const page = await service.tickets(
      c.req.param('id'),
      { page: intParam(q.page, 'page'), boardId: intParam(q.boardId, 'board'), iterationId: intParam(q.iterationId, 'iteration'), mine: q.mine !== '0', statuses: c.req.queries('status') },
      q.refresh === '1',
    )
    return c.json(page)
  })
  // Your subtasks in one iteration (Helix search cannot find them; they are read through their parents).
  app.get(`${base}/:id/my-subtasks`, async (c) => {
    const q = c.req.query()
    const iterationId = intParam(q.iterationId, 'iteration')
    if (iterationId === undefined) throw new UserError('invalid_query', 'Pick an iteration first')
    return c.json(await service.mySubtasks(c.req.param('id'), { boardId: intParam(q.boardId, 'board'), iterationId }, q.refresh === '1'))
  })
  // Copy one ticket to our board (the full ticket is read again first).
  app.post(`${base}/:id/transfer`, async (c) => {
    const key = ((await c.req.json()) as { key?: unknown }).key
    if (typeof key !== 'string' || !key) throw new UserError('invalid_ticket_key', 'Pick a ticket')
    return c.json(await service.transfer(c.req.param('id'), key), 201)
  })
  app.get(`${base}/:id/tickets/:key/children`, async (c) => c.json(await service.children(c.req.param('id'), c.req.param('key'))))
  app.get(`${base}/:id/tickets/:key`, async (c) => c.json(await service.ticket(c.req.param('id'), c.req.param('key'))))
}
