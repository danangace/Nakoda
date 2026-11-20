import type { DocNodeT } from '../../shared/schemas'

/** All folder paths in the docs tree, for the "docs folder" field suggestions. */
export function docFolders(nodes: DocNodeT[]): string[] {
  const out: string[] = []
  const walk = (list: DocNodeT[]) => {
    for (const n of list) {
      if (!n.dir) continue
      out.push(n.path)
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** Every note path in the docs tree (relative to the docs root), to tell which doc paths already exist. */
export function docFiles(nodes: DocNodeT[]): Set<string> {
  const out = new Set<string>()
  const walk = (list: DocNodeT[]) => {
    for (const n of list) {
      if (n.dir) walk(n.children ?? [])
      else out.add(n.path)
    }
  }
  walk(nodes)
  return out
}
