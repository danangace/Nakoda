import type { Hono } from 'hono'
import { UserError } from '../errors'
import type { BreakdownService } from './service'

export function registerBreakdownRoutes(app: Hono, service: BreakdownService): void {
  const base = '/api/breakdown'
  // Is the spec ready: the open questions next to it.
  app.get(`${base}/spec-check`, (c) => {
    const path = c.req.query('path')
    if (!path) throw new UserError('invalid_query', 'Pick a document first')
    return c.json(service.specCheck(path))
  })
  app.post(`${base}/draft`, async (c) => c.json(await service.draft(await c.req.json())))
  app.get(`${base}/source`, (c) => {
    const { connectorId, key } = c.req.query()
    if (!connectorId || !key) throw new UserError('invalid_query', 'Pick a ticket first')
    return c.json(service.source(connectorId, key))
  })
  app.put(`${base}/source`, async (c) => c.json(service.saveSource(await c.req.json())))
}
