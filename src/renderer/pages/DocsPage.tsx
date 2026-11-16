import { Check, Copy } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { type DocFile, api } from '../api/nakoda'
import { Markdown } from '../components/docs-browser/Markdown'
import { Notice } from '../components/ui/Field'
import { errorText } from '../lib/errors'
import { wikiToMarkdown } from '../lib/wiki'
import { useAppEvents } from '../store/events'
import { useRouter } from '../store/router'

function Frontmatter({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  if (entries.length === 0) return null
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span key={key} className="rounded bg-secondary px-2 py-0.5 text-xs text-foreground/80">
          <span className="text-muted-foreground">{key}:</span> {Array.isArray(value) ? value.join(', ') : String(value)}
        </span>
      ))}
    </div>
  )
}

/** One path with a copy button, for pasting into notes or a terminal. */
function PathLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 break-all font-mono text-foreground/80 select-text">{value}</span>
      <button
        type="button"
        aria-label={`Copy ${label.toLowerCase()}`}
        title={`Copy ${label.toLowerCase()}`}
        onClick={copy}
        className="shrink-0 rounded p-1 hover:bg-secondary hover:text-foreground"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

/** Read-only docs browser (D-5): there is no edit or save action anywhere on this page. */
export function DocsPage({ path }: { path: string }) {
  const navigate = useRouter((s) => s.navigate)
  const [doc, setDoc] = useState<DocFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const open = useCallback((p: string) => navigate({ name: 'docs', path: p }), [navigate])

  const load = useCallback(() => {
    if (!path) return setDoc(null)
    api.docsFile(path).then(
      (d) => {
        setDoc(d)
        setError(null)
      },
      (e: unknown) => setError(errorText(e)),
    )
  }, [path])
  useEffect(load, [load])

  // Live reload when the note (or the tree) changes on disk, e.g. saved in Obsidian (AC-D6).
  useAppEvents((event) => {
    if (event.type !== 'docs.changed') return
    if (event.path === path) load()
  })

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-6">
          {error && <Notice tone="error">{error}</Notice>}
          {!path && !error && <p className="text-sm text-muted-foreground">Pick a note in the sidebar. Docs are read-only here; edit them in Obsidian.</p>}
          {doc && (
            <>
              <div className="mb-3 space-y-0.5">
                <PathLine label="Path" value={doc.fullPath} />
                <PathLine label="Folder" value={doc.fullPath.replace(/\/[^/]*$/, '')} />
              </div>
              <Frontmatter data={doc.frontmatter} />
              <Markdown source={wikiToMarkdown(doc.body, doc.links)} onOpenDoc={open} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
