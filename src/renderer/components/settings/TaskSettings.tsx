import { useEffect, useState } from 'react'
import { HELIX_STATUSES, HELIX_SUBTASK_STATUSES, type Connector, type Iteration } from '../../../shared/connectors'
import type { Settings, TaskDefaults } from '../../../shared/schemas'
import { api } from '../../api/nakoda'
import { errorText } from '../../lib/errors'
import { statusLabel } from '../../lib/tasks-tabs'
import { useRouter } from '../../store/router'
import { toast } from '../../store/toast'
import { Button } from '@/components/ui/button'
import { Card, Field, Notice } from '../ui/Field'
import { Select } from '../ui/Select'

const ANY = 'any'
const ACTIVE = 'active'

/** Settings → Tasks: what the Tasks page starts with, so you do not set the filters at every visit. Helix is the only source today. */
export function TaskSettings() {
  const navigate = useRouter((s) => s.navigate)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [connectors, setConnectors] = useState<Connector[] | null>(null)
  const [boards, setBoards] = useState<{ id: number; name: string }[]>([])
  const [iterations, setIterations] = useState<Iteration[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const connector = connectors?.[0]
  const defaults = settings?.taskDefaults

  useEffect(() => {
    api.getSettings().then(setSettings, (e: unknown) => setMessage(errorText(e)))
    api.listConnectors().then(setConnectors, (e: unknown) => setMessage(errorText(e)))
  }, [])
  useEffect(() => {
    if (connector) api.connectorBoards(connector.id).then(setBoards, () => setBoards([]))
  }, [connector])
  useEffect(() => {
    setIterations([])
    if (connector && defaults?.boardId != null) api.connectorIterations(connector.id, defaults.boardId).then(setIterations, () => setIterations([]))
  }, [connector, defaults?.boardId])

  if (!settings || !defaults || !connectors) return message ? <Notice tone="error">{message}</Notice> : null
  if (!connector) {
    return (
      <div className="space-y-3 rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">No task source is connected yet.</p>
        <Button variant="secondary" onClick={() => navigate({ name: 'settings', section: 'connectors' })}>Connect Helix</Button>
      </div>
    )
  }

  const set = (patch: Partial<TaskDefaults>) => setSettings({ ...settings, taskDefaults: { ...defaults, ...patch } })
  const save = async () => {
    try {
      setSettings(await api.saveSettings(settings))
      setMessage(null)
      toast.success('Tasks saved', 'The Tasks page opens with these filters.')
    } catch (e) {
      setMessage(errorText(e))
    }
  }

  return (
    <Card
      title={`Tasks · ${connector.label}`}
      actions={
        <Button variant="default" onClick={save}>
          Save
        </Button>
      }
    >
      {message && <Notice tone="error">{message}</Notice>}
      <p className="text-xs text-muted-foreground">The Tasks page starts with these. You can still change the filters there; they are not saved from the page.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Show">
          <Select aria-label="Show" value={defaults.scope} onValueChange={(v) => set({ scope: v === 'everyone' ? 'everyone' : 'mine' })} options={[{ value: 'mine', label: 'Assigned to me' }, { value: 'everyone', label: 'Everyone' }]} />
        </Field>
        <Field label="Board">
          <Select
            aria-label="Default board"
            value={defaults.boardId === null ? ANY : String(defaults.boardId)}
            onValueChange={(v) => set({ boardId: v === ANY ? null : Number(v), iteration: null })}
            options={[{ value: ANY, label: 'All boards' }, ...boards.map((b) => ({ value: String(b.id), label: b.name }))]}
          />
        </Field>
        <Field label="Iteration" hint={defaults.boardId === null ? 'Pick a board first; iterations belong to a board.' : '"Active iteration" follows whichever one is active, so it needs no change each sprint.'}>
          <Select
            aria-label="Default iteration"
            value={defaults.iteration === null ? ANY : String(defaults.iteration)}
            disabled={defaults.boardId === null}
            onValueChange={(v) => set({ iteration: v === ANY ? null : v === ACTIVE ? ACTIVE : Number(v) })}
            options={[{ value: ANY, label: 'All iterations' }, { value: ACTIVE, label: 'Active iteration (automatic)' }, ...iterations.map((i) => ({ value: String(i.id), label: i.name }))]}
          />
        </Field>
        <Field label="Status">
          <Select aria-label="Default status" value={defaults.status ?? ANY} onValueChange={(v) => set({ status: v === ANY ? null : v })} options={[{ value: ANY, label: 'All statuses' }, ...HELIX_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))]} />
        </Field>
        <Field label="Subtask status">
          <Select aria-label="Default subtask status" value={defaults.subStatus ?? ANY} onValueChange={(v) => set({ subStatus: v === ANY ? null : v })} options={[{ value: ANY, label: 'All subtask statuses' }, ...HELIX_SUBTASK_STATUSES.map((s) => ({ value: s.status, label: s.label }))]} />
        </Field>
      </div>
    </Card>
  )
}
