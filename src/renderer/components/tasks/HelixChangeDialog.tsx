import { useEffect, useState } from 'react'
import type { Connector, HelixWrite, WriteOutcome, WritePreview } from '../../../shared/connectors'
import { api } from '../../api/nakoda'
import { errorText } from '../../lib/errors'
import { toast } from '../../store/toast'
import { Button } from '@/components/ui/button'
import { Field, Notice } from '../ui/Field'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/SelectInput'

type Mode = 'status' | 'comment'
type Info = { title: string; type: string; status: string; next: string[]; known: boolean }

const label = (status: string) => (status ? status.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()) : '')

/**
 * Change one Helix ticket: move its status (with a note in the same step) or comment. Nothing is sent
 * until the exact request has been shown and "Send to Helix" is pressed.
 */
export function HelixChangeDialog({ connector, ticketKey, onClose, onDone }: { connector: Connector; ticketKey: string; onClose: () => void; onDone?: () => void }) {
  const [mode, setMode] = useState<Mode>('status')
  const [info, setInfo] = useState<Info | null>(null)
  const [status, setStatus] = useState('')
  const [text, setText] = useState('')
  const [stage, setStage] = useState<'compose' | 'preview' | 'sent'>('compose')
  const [preview, setPreview] = useState<WritePreview | null>(null)
  const [outcome, setOutcome] = useState<WriteOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const ticket = await api.connectorTicket(connector.id, ticketKey)
        const boards = await api.connectorBoards(connector.id)
        const board = boards.find((b) => b.name === ticket.board)
        const moves = board ? await api.helixTransitions(connector.id, board.id).catch(() => null) : null
        if (alive) setInfo({ title: ticket.title, type: ticket.type, status: ticket.status, next: moves?.[ticket.type]?.[ticket.status] ?? [], known: moves !== null })
      } catch (e) {
        if (alive) setError(errorText(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [connector.id, ticketKey])

  const action = (): HelixWrite =>
    mode === 'status' ? { action: 'status', key: ticketKey, status, ...(text.trim() ? { comment: text.trim() } : {}) } : { action: 'comment', key: ticketKey, content: text }
  const ready = mode === 'status' ? status !== '' : text.trim() !== ''

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
  const showPreview = () =>
    run(async () => {
      setPreview(await api.previewHelixWrite(connector.id, action()))
      setStage('preview')
    })
  const send = () =>
    run(async () => {
      const result = await api.applyHelixWrite(connector.id, action())
      setOutcome(result)
      setStage('sent')
      if (result.ok) {
        toast.success('Helix updated', preview?.summary)
        onDone?.()
      }
    })

  return (
    <Modal title={`Update ${ticketKey} in Helix`} onClose={onClose} width="max-w-xl">
      <div className="space-y-4" data-testid="helix-change">
        {info && (
          <p className="text-sm text-foreground/80">
            {info.title} <span className="text-muted-foreground">· {label(info.status)}</span>
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        {stage === 'compose' && (
          <>
            <div role="tablist" className="flex gap-1 text-sm">
              {(['status', 'comment'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={mode === m ? 'rounded-md bg-secondary px-3 py-1 text-foreground' : 'rounded-md px-3 py-1 text-muted-foreground hover:text-foreground'}
                >
                  {m === 'status' ? 'Move status' : 'Comment'}
                </button>
              ))}
            </div>
            {mode === 'status' && (
              <Field label="Move to" hint={info && info.next.length === 0 ? (info.known ? 'Helix has no move from this status.' : 'Could not read where this ticket may go.') : undefined}>
                <Select aria-label="Move to" value={status} onValueChange={setStatus} options={(info?.next ?? []).map((s) => ({ value: s, label: label(s) }))} placeholder={info ? 'Choose a status…' : 'Loading…'} disabled={!info || info.next.length === 0} />
              </Field>
            )}
            <Field label={mode === 'status' ? 'Note (optional)' : 'Comment'} hint={mode === 'status' ? 'Saved with the move, as your comment on the ticket.' : 'Comments cannot be edited or deleted afterwards.'}>
              <Textarea aria-label={mode === 'status' ? 'Note' : 'Comment'} rows={4} className="field-sizing-fixed resize-y" value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button variant="default" disabled={!ready || busy} onClick={() => void showPreview()}>
                Review
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {stage === 'preview' && preview && (
          <>
            <p className="text-sm font-medium text-foreground">{preview.summary}</p>
            <div className="space-y-2" data-testid="helix-preview">
              {preview.requests.map((r) => (
                <div key={`${r.method}${r.path}${JSON.stringify(r.body)}`} className="rounded-md border border-border bg-background/40 p-2.5">
                  <div className="font-mono text-xs text-foreground">
                    {r.method} {r.path}
                  </div>
                  <pre className="mt-1 text-xs break-words whitespace-pre-wrap text-muted-foreground">{JSON.stringify(r.body, null, 2)}</pre>
                </div>
              ))}
            </div>
            {preview.notes.map((n) => (
              <Notice key={n} tone="info">
                {n}
              </Notice>
            ))}
            <div className="flex gap-2">
              <Button variant="default" data-testid="helix-send" disabled={busy} onClick={() => void send()}>
                {busy ? 'Sending…' : 'Send to Helix'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setStage('compose')}>
                Back
              </Button>
            </div>
          </>
        )}

        {stage === 'sent' && outcome && (
          <>
            {outcome.ok ? <Notice tone="ok">Done. {outcome.done.map((d) => d.key).join(', ')} updated in Helix.</Notice> : <Notice tone="error">{outcome.failure?.message ?? 'Helix did not accept the change.'}</Notice>}
            {outcome.warnings.map((w) => (
              <Notice key={w} tone="info">
                {w}
              </Notice>
            ))}
            <div className="flex gap-2">
              {!outcome.ok && (
                <Button variant="secondary" onClick={() => setStage('compose')}>Edit</Button>
              )}
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
