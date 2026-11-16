import { Check, ChevronDown, ChevronRight, Copy, FileText, Folder } from 'lucide-react'
import { useState } from 'react'
import type { DocNodeT } from '../../../shared/schemas'
import { cn } from '../../lib/cn'

/** Copies a node's absolute path; shown on row hover. */
export function CopyPathButton({ path, label }: { path: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy ${label} path`}
      title={`Copy ${label} path`}
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard.writeText(path).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className={cn(
        'shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground',
        copied ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

const join = (root: string, rel: string) => (rel ? `${root.replace(/\/$/, '')}/${rel}` : root)

function Node({ node, active, onOpen, depth, root }: { node: DocNodeT; active: string; onOpen: (p: string) => void; depth: number; root: string }) {
  const [open, setOpen] = useState(active.startsWith(`${node.path}/`))
  const pad = { paddingLeft: 8 + depth * 14 }
  if (!node.dir) {
    return (
      <div className="group/row flex items-center pr-1">
        <button
          type="button"
          style={pad}
          onClick={() => onOpen(node.path)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 truncate rounded-md py-1 pr-2 text-left text-sm',
            node.path === active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <FileText size={16} className="shrink-0" />
          <span className="truncate">{node.name.replace(/\.md$/, '')}</span>
        </button>
        {root && <CopyPathButton path={join(root, node.path)} label="file" />}
      </div>
    )
  }
  return (
    <div>
      <div className="group/row flex items-center pr-1">
        <button
          type="button"
          style={pad}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md py-1 pr-2 text-left text-sm font-medium text-foreground/80 hover:bg-foreground/5 hover:text-foreground"
        >
          {open ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
          <Folder size={16} className="shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {root && <CopyPathButton path={join(root, node.path)} label="folder" />}
      </div>
      {open && node.children?.map((c) => <Node key={c.path} node={c} active={active} onOpen={onOpen} depth={depth + 1} root={root} />)}
    </div>
  )
}

export function DocTree({ nodes, active, onOpen, root = '' }: { nodes: DocNodeT[]; active: string; onOpen: (path: string) => void; root?: string }) {
  return (
    <div className="space-y-px">
      {nodes.map((n) => (
        <Node key={n.path} node={n} active={active} onOpen={onOpen} depth={0} root={root} />
      ))}
    </div>
  )
}
