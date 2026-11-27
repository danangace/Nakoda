import { useEffect, useMemo, useState } from 'react'
import { MAX_SUBTASKS, PARENT_TYPES_FOR_SUBTASKS, checkRow, extractBreakdown, findSimilar, formatSubtaskList, normalizeTitle, parseSubtaskList } from '../../../shared/breakdown'
import type { Connector, SubtaskDraft, WriteOutcome, WritePreview } from '../../../shared/connectors'
import type { DocNodeT } from '../../../shared/schemas'
import { type BreakdownSource, type DocFile, type SpecCheck, api } from '../../api/nakoda'
import { cn } from '../../lib/cn'
import { errorText } from '../../lib/errors'
import { wikiToMarkdown } from '../../lib/wiki'
import { toast } from '../../store/toast'
import { Markdown } from '../docs-browser/Markdown'
import { Button } from '@/components/ui/button'
import { Checkbox } from '../ui/CheckboxField'
import { Field, Notice } from '../ui/Field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '../ui/Modal'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConfirm } from '../ui/confirm'

type Step = 'source' | 'rows' | 'preview' | 'sent'
/** breakdown = a document that already holds the list (made with the skill); spec = raw spec, Claude drafts the list; text = you write it. */
type Source = 'breakdown' | 'spec' | 'text'
type Row = { id: number; title: string; points: string }
type Parent = { title: string; type: string; status: string }

const FORMAT_HINT = 'One subtask per line, or a list. Start with [FE] or [BE]; put story points at the end like (3).'
const EXAMPLE = '- [BE] Add paged invoice list endpoint (2)\n- [FE] Show invoice list with search and status filter (3)'

const flatten = (nodes: DocNodeT[]): string[] => nodes.flatMap((n) => (n.dir ? flatten(n.children ?? []) : [n.path]))
const pointsOf = (s: string): number | null => (s.trim() === '' ? null : Number(s))

/**
 * Break one Helix story into subtasks. You choose where the list comes from (a docs page, shown next to
 * it, or your own text), fix it in a table, see the exact requests, and only then are they created, one
 * by one, under the story that already exists.
 */
export function BreakdownDialog({ connector, ticketKey, onClose, onDone }: { connector: Connector; ticketKey: string; onClose: () => void; onDone?: () => void }) {
  const [step, setStep] = useState<Step>('source')
  const [parent, setParent] = useState<Parent | null>(null)
  const [existing, setExisting] = useState<{ key: string; title: string }[]>([])
  const [me, setMe] = useState<{ id: number; name: string } | null>(null)
  const [source, setSource] = useState<Source>('breakdown')
  const [tree, setTree] = useState<string[] | null>(null)
  const [filter, setFilter] = useState('')
  const [doc, setDoc] = useState<DocFile | null>(null)
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [assignMe, setAssignMe] = useState(true)
  const [start, setStart] = useState('')
  const [preview, setPreview] = useState<WritePreview | null>(null)
  const [outcome, setOutcome] = useState<WriteOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()
  const [check, setCheck] = useState<SpecCheck | null>(null)
  const [previous, setPrevious] = useState<BreakdownSource | null>(null)
  const [instruction, setInstruction] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [drafted, setDrafted] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [found, setFound] = useState<{ path: string; count: number } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [ticket, children, owner] = await Promise.all([api.connectorTicket(connector.id, ticketKey), api.ticketChildren(connector.id, ticketKey), api.connectorOwner(connector.id)])
        if (!alive) return
        setParent({ title: ticket.title, type: ticket.type, status: ticket.status })
        setExisting(children.filter((c) => c.type === 'subtask').map((c) => ({ key: c.key, title: c.title })))
        setMe({ id: owner.id, name: owner.name })
        // One document per parent ticket: come back to the one it was broken down from.
        const before = await api.breakdownSource(connector.id, ticketKey).catch(() => null)
        if (alive && before) {
          setPrevious(before)
          void pick(before.docPath, 'breakdown', true)
        }
      } catch (e) {
        if (alive) setError(errorText(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [connector.id, ticketKey])

  // The docs list is only needed when a document is the source.
  useEffect(() => {
    if (source === 'text' || tree) return
    api.docsTree().then(
      (nodes) => {
        const files = flatten(nodes)
        setTree(files)
        // A breakdown document usually carries the ticket's key in its name: show those first.
        if (files.some((p) => p.includes(ticketKey))) setFilter((f) => f || ticketKey)
      },
      (e: unknown) => setError(errorText(e)),
    )
  }, [source, tree, ticketKey])

  const blocked = parent
    ? !(PARENT_TYPES_FOR_SUBTASKS as readonly string[]).includes(parent.type)
      ? `A ${parent.type.replaceAll('_', ' ')} cannot have subtasks in Helix.`
      : parent.status === 'done'
        ? 'This ticket is done, and Helix refuses new subtasks under it.'
        : null
    : null

  /**
   * Open a document. In "breakdown" mode its list is taken straight into the editor (no Claude); a document with
   * no list there is probably a spec, so `fallback` moves to the spec tab instead of leaving an empty editor.
   */
  const pick = async (path: string, mode: Source = source, fallback = false): Promise<void> => {
    setCheck(null)
    setFound(null)
    try {
      const [d, c] = await Promise.all([api.docsFile(path), api.breakdownSpecCheck(path).catch(() => null)])
      setDoc(d)
      setCheck(c)
      setError(null)
      if (mode !== 'breakdown') return
      const list = extractBreakdown(d.body)
      setFound({ path, count: list.rows.length })
      if (list.rows.length === 0) {
        if (fallback) setSource('spec')
        return
      }
      const next = formatSubtaskList(list.rows, list.notes)
      if (text.trim() && text.trim() !== next && !(await confirm({ title: 'Replace the list with this document’s?', description: 'What you wrote in the list is replaced by the list found in the document.', confirmLabel: 'Replace' }))) return
      setText(next)
      setDrafted(null)
    } catch (e) {
      setError(errorText(e))
    }
  }
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (tree ?? []).filter((p) => !q || p.toLowerCase().includes(q)).slice(0, 60)
  }, [tree, filter])

  const draftWithClaude = async () => {
    if (!doc) return
    if (text.trim() && !(await confirm({ title: 'Replace the list with a draft?', description: 'What you wrote in the list is replaced by Claude’s draft.', confirmLabel: 'Replace' }))) return
    setDrafting(true)
    setError(null)
    try {
      const result = await api.breakdownDraft({ connectorId: connector.id, key: ticketKey, docPath: doc.path, ...(instruction.trim() ? { hint: instruction.trim() } : {}) })
      setText(result.text)
      setTruncated(result.truncated)
      setDrafted(`Drafted by Claude (${result.model}, account ${result.account}). Read it and fix what is off before you continue.`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setDrafting(false)
    }
  }

  const toRows = () => {
    const parsed = parseSubtaskList(text)
    if (parsed.rows.length === 0) return setError('Write at least one subtask first.')
    if (parsed.rows.length > MAX_SUBTASKS) return setError(`At most ${MAX_SUBTASKS} subtasks at a time. A story this big is worth splitting.`)
    setError(null)
    setNotes(parsed.notes)
    setRows(parsed.rows.map((r, i) => ({ id: i, title: r.title, points: r.storyPoint === null ? '' : String(r.storyPoint) })))
    setStep('rows')
  }

  const issues = rows.map((r, i) => {
    const list = checkRow(r.title, pointsOf(r.points)).map((x) => ({ ...x }))
    const same = findSimilar(r.title, existing)
    if (same) list.push({ level: 'warning', text: `Looks like ${same.key}: ${same.title}` })
    const norm = normalizeTitle(r.title)
    if (norm && rows.slice(0, i).some((o) => normalizeTitle(o.title) === norm)) list.push({ level: 'warning', text: 'Same as a subtask above' })
    return list
  })
  const hasError = issues.some((l) => l.some((x) => x.level === 'error'))

  const items = (): SubtaskDraft[] =>
    rows.map((r) => {
      const points = pointsOf(r.points)
      return { title: r.title.trim(), ...(points ? { storyPoint: points } : {}), ...(assignMe && me ? { assigneeId: me.id } : {}), ...(start ? { targetStartDate: start } : {}) }
    })

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const review = () =>
    run(async () => {
      setPreview(await api.previewHelixWrite(connector.id, { action: 'subtasks', parentKey: ticketKey, items: items() }))
      setStep('preview')
    })
  const create = () =>
    run(async () => {
      const result = await api.applyHelixWrite(connector.id, { action: 'subtasks', parentKey: ticketKey, items: items() })
      setOutcome(result)
      setStep('sent')
      if (result.done.length > 0) {
        onDone?.()
        if (doc) void api.saveBreakdownSource({ connectorId: connector.id, key: ticketKey, docPath: doc.path, created: result.done.length }).catch(() => undefined)
      }
      if (result.ok) toast.success('Subtasks created', `${result.done.length} under ${ticketKey}`)
    })
  const backToEdit = () => {
    // What Helix already accepted must not be sent again.
    const made = (outcome?.done ?? []).map((d) => d.title)
    setRows((cur) => cur.filter((r) => { const i = made.indexOf(r.title.trim()); if (i >= 0) { made.splice(i, 1); return false } return true }))
    setOutcome(null)
    setStep('rows')
  }

  const wide = step === 'source' && source !== 'text'
  return (
    <Modal title={`Break down ${ticketKey}`} onClose={onClose} width={wide ? 'max-w-5xl' : 'max-w-2xl'}>
      <div className="space-y-4" data-testid="breakdown">
        {parent && (
          <p className="text-sm text-foreground/80">
            {parent.title} <span className="text-muted-foreground">· {parent.type.replaceAll('_', ' ')} · {parent.status.replaceAll('_', ' ')}</span>
            {existing.length > 0 && <span className="text-muted-foreground"> · {existing.length} subtask{existing.length === 1 ? '' : 's'} already</span>}
          </p>
        )}
        {blocked && <Notice tone="error">{blocked}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        {step === 'source' && parent && !blocked && (
          <>
            <Tabs
              value={source}
              onValueChange={(v) => {
                const next = v as Source
                setSource(next)
                setFound(null)
                if (doc && next === 'breakdown') void pick(doc.path, 'breakdown')
              }}
            >
              <TabsList>
                <TabsTrigger value="breakdown">From a breakdown document</TabsTrigger>
                <TabsTrigger value="spec">From a spec</TabsTrigger>
                <TabsTrigger value="text">Write a list</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className={cn('grid gap-4', wide && 'grid-cols-[1fr_22rem]')}>
              {source !== 'text' && (
                <div className="min-w-0 space-y-2">
                  <Input aria-label="Find a document" placeholder="Find a document…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded-md border border-border p-1 text-sm" data-testid="doc-list">
                    {tree === null && !error && <li className="px-2 py-1 text-muted-foreground">Loading…</li>}
                    {tree !== null && matches.length === 0 && <li className="px-2 py-1 text-muted-foreground">No document matches.</li>}
                    {matches.map((p) => (
                      <li key={p}>
                        <button type="button" onClick={() => void pick(p)} className={cn('w-full truncate rounded px-2 py-1 text-left font-mono text-xs hover:bg-secondary', doc?.path === p && 'bg-secondary text-foreground')}>
                          {p}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {previous && doc?.path === previous.docPath && (
                    <Notice tone="info">
                      You broke this ticket down from this document before: {previous.created} subtask{previous.created === 1 ? '' : 's'} created, last {new Date(previous.updatedAt).toLocaleDateString()}.
                    </Notice>
                  )}
                  {previous && doc && doc.path !== previous.docPath && (
                    <Notice tone="info">
                      Last time this ticket was broken down from {previous.docPath} ({previous.created} subtask{previous.created === 1 ? '' : 's'} created). Subtasks that already exist are flagged in the table.
                    </Notice>
                  )}
                  {source === 'breakdown' && found && (
                    <div data-testid="breakdown-found">
                      {found.count > 0 ? (
                        <Notice tone="ok">Found {found.count} subtask{found.count === 1 ? '' : 's'} in this document. They are in the list; fix them there.</Notice>
                      ) : (
                        <Notice tone="error">No [FE]/[BE] list in this document. If it is a spec, use “From a spec” and let Claude draft one.</Notice>
                      )}
                    </div>
                  )}
                  {source === 'spec' && check && (
                    <div data-testid="spec-check">
                      {check.questionsPath === null ? null : check.open.length === 0 ? (
                        <Notice tone="ok">Open Questions: all {check.total} answered.</Notice>
                      ) : (
                        <Notice tone="info">
                          {check.open.length} of {check.total} open questions are still open: {check.open.map((q) => `${q.id} ${q.topic}`).join(' · ')}. A breakdown is high level, so you can go on; Claude notes any gap it meets.
                        </Notice>
                      )}
                    </div>
                  )}
                  <div className="max-h-[42vh] overflow-y-auto rounded-md border border-border bg-background/40 p-3" data-testid="doc-view">
                    {doc ? <Markdown source={wikiToMarkdown(doc.body, doc.links)} onOpenDoc={(p) => void pick(p)} /> : <p className="text-sm text-muted-foreground">Pick a document to read it here while you write the list.</p>}
                  </div>
                </div>
              )}
              <div className="space-y-3">
                {source === 'spec' && (
                  <div className="space-y-1.5 rounded-md border border-border p-2.5">
                    <Input aria-label="Instruction for Claude" placeholder="Optional: e.g. the API already exists, no [BE] work" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
                    <Button variant="secondary" data-testid="draft-with-claude" disabled={!doc || drafting} onClick={() => void draftWithClaude()}>
                      {drafting ? 'Drafting… (about a minute)' : 'Draft with Claude'}
                    </Button>
                    {!doc && <p className="text-xs text-muted-foreground">Pick the spec first. Claude reads it with the ticket and the subtasks that already exist; nothing is sent to Helix.</p>}
                  </div>
                )}
                {drafted && <Notice tone="info">{drafted}</Notice>}
                {truncated && <Notice tone="error">The spec is very long and was cut before Claude read it. Check that nothing important was left out.</Notice>}
                <Field label="Subtasks" hint={FORMAT_HINT}>
                  <Textarea aria-label="Subtasks" rows={wide ? 14 : 8} placeholder={EXAMPLE} className="field-sizing-fixed resize-y font-mono text-xs md:text-xs" value={text} onChange={(e) => setText(e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="default" disabled={!text.trim()} onClick={toRows}>
                Continue
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {step === 'rows' && (
          <>
            <div className="space-y-2" data-testid="breakdown-rows">
              {rows.map((r, i) => (
                <div key={r.id} className="space-y-1">
                  <div className="flex gap-2">
                    <Input aria-label={`Subtask ${i + 1} title`} value={r.title} onChange={(e) => setRows(rows.map((o) => (o.id === r.id ? { ...o, title: e.target.value } : o)))} />
                    <Input aria-label={`Subtask ${i + 1} points`} type="number" min={1} placeholder="pts" className="w-20 shrink-0" value={r.points} onChange={(e) => setRows(rows.map((o) => (o.id === r.id ? { ...o, points: e.target.value } : o)))} />
                    <Button variant="ghost" aria-label={`Remove subtask ${i + 1}`} onClick={() => setRows(rows.filter((o) => o.id !== r.id))}>
                      ✕
                    </Button>
                  </div>
                  {(issues[i] ?? []).map((x) => (
                    <div key={x.text} className={cn('pl-1 text-xs', x.level === 'error' ? 'text-red-300' : 'text-warning')}>
                      {x.text}
                    </div>
                  ))}
                </div>
              ))}
              {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing left. Go back to write more.</p>}
            </div>
            {notes.map((n) => (
              <Notice key={n} tone="info">
                {n}
              </Notice>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <Checkbox checked={assignMe} onCheckedChange={setAssignMe}>
                <span className="text-sm">Assign to me{me ? ` (${me.name})` : ''}</span>
              </Checkbox>
              <Field label="Planned start (optional)">
                <Input aria-label="Planned start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button variant="default" disabled={rows.length === 0 || hasError || busy} onClick={() => void review()}>
                Review {rows.length} subtask{rows.length === 1 ? '' : 's'}
              </Button>
              <Button variant="ghost" onClick={() => setStep('source')}>
                Back
              </Button>
            </div>
          </>
        )}

        {step === 'preview' && preview && (
          <>
            <p className="text-sm font-medium text-foreground">{preview.summary}</p>
            <div className="max-h-[40vh] space-y-1.5 overflow-y-auto" data-testid="breakdown-preview">
              {preview.requests.map((r) => (
                <div key={JSON.stringify(r.body)} className="rounded-md border border-border bg-background/40 px-2.5 py-1.5">
                  <div className="font-mono text-xs text-foreground">
                    {r.method} {r.path}
                  </div>
                  <div className="font-mono text-xs break-words text-muted-foreground">{JSON.stringify(r.body)}</div>
                </div>
              ))}
            </div>
            {preview.notes.map((n) => (
              <Notice key={n} tone="info">
                {n}
              </Notice>
            ))}
            <div className="flex gap-2">
              <Button variant="default" data-testid="breakdown-create" disabled={busy} onClick={() => void create()}>
                {busy ? 'Creating…' : `Create ${preview.requests.length} in Helix`}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setStep('rows')}>
                Back
              </Button>
            </div>
          </>
        )}

        {step === 'sent' && outcome && (
          <>
            {outcome.done.length > 0 && (
              <Notice tone="ok">
                Created {outcome.done.length}: {outcome.done.map((d) => `${d.key}${d.title ? ` ${d.title}` : ''}`).join(' · ')}
              </Notice>
            )}
            {!outcome.ok && (
              <Notice tone="error">
                {outcome.failure?.title ? `"${outcome.failure.title}": ` : ''}
                {outcome.failure?.message ?? 'Helix did not accept the change.'} The ones after it were not tried.
              </Notice>
            )}
            {outcome.warnings.map((w) => (
              <Notice key={w} tone="info">
                {w}
              </Notice>
            ))}
            <div className="flex gap-2">
              {!outcome.ok && <Button variant="secondary" onClick={backToEdit}>Fix the rest</Button>}
              <Button variant="default" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
