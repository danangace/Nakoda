import { copyFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { getWorkflow } from '../workflows/service'
import { migrate, openDb } from './db'

const MIGRATIONS = join(import.meta.dirname, 'migrations')

describe('migration 007 (handling expectation)', () => {
  it('seeds the new choices on a fresh database', () => {
    const wf = getWorkflow(openDb(':memory:'), 'defect')
    expect(wf.fields.find((f) => f.key === 'handling')?.options).toEqual(['defect development', 'defect staging', 'hotfix'])
  })

  it('moves an existing database over: new options, old values cleared, hotfix kept', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nakoda-mig7-'))
    mkdirSync(dir, { recursive: true })
    for (const f of readdirSync(MIGRATIONS).filter((n) => n < '007')) copyFileSync(join(MIGRATIONS, f), join(dir, f))
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, dir)
    const now = new Date().toISOString()
    const insert = db.prepare("INSERT INTO tasks (id, title, description, kind, board_column, position, priority, workflow_id, values_json, source, created_at, updated_at) VALUES (?, 't', '', 'defect', 'backlog', ?, '', 'defect', ?, 'manual', ?, ?)")
    insert.run('a', 1, JSON.stringify({ handling: 'next-iteration', app: 'core' }), now, now)
    insert.run('b', 2, JSON.stringify({ handling: 'hotfix' }), now, now)
    migrate(db)
    const values = (id: string) => JSON.parse((db.prepare('SELECT values_json v FROM tasks WHERE id = ?').get(id) as { v: string }).v) as Record<string, string>
    expect(values('a')).toEqual({ handling: '', app: 'core' })
    expect(values('b')).toEqual({ handling: 'hotfix' })
    expect(getWorkflow(db as never, 'defect').fields.find((f) => f.key === 'handling')?.options).toEqual(['defect development', 'defect staging', 'hotfix'])
  })
})
