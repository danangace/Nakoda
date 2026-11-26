import { type HelixTicket, SECTIONS } from './helix'

/** Editable on the connection: how Helix words map to Nakoda's. */
export type Mappings = { severity: Record<string, string>; environment: Record<string, string> }

export const DEFAULT_MAPPINGS: Mappings = {
  // Helix severity → Nakoda (intake checklist) severity.
  severity: { critical: 'critical', high: 'major', medium: 'minor', low: 'minor' },
  // Helix ticket type → environment. Only staging is known; the rest stays empty for a human.
  environment: { defect_staging: 'staging' },
}

/**
 * A subtask carries little of its own: no description, no PRD or Figma. It gets them from its
 * parent story: the story's text under "Parent story", and its links and iteration when missing.
 */
export function withParent(ticket: HelixTicket, parent: HelixTicket): HelixTicket {
  const parentText = SECTIONS.map(([key, heading]) => [heading, parent.sections[key] ?? ''] as const)
    .filter(([, md]) => md !== '')
    .map(([heading, md]) => `### ${heading}\n\n${md}`)
    .join('\n\n')
  const block = `## Parent story: [${parent.key}](${parent.url}) — ${parent.title}${parentText ? `\n\n${parentText}` : ''}`
  return {
    ...ticket,
    description: [ticket.description, block].filter(Boolean).join('\n\n'),
    prdLinks: ticket.prdLinks.length ? ticket.prdLinks : parent.prdLinks,
    figmaLinks: ticket.figmaLinks.length ? ticket.figmaLinks : parent.figmaLinks,
    iteration: ticket.iteration ?? parent.iteration,
    iterationName: ticket.iterationName ?? parent.iterationName,
  }
}

/** Folder-safe name from a title: "[FE] Link redirect!" → "fe-link-redirect". */
export function slug(text: string, max = 40): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '')
}

/** The first Figma link if there is one, otherwise the first link. */
const pickFigma = (links: string[]): string => links.find((l) => /figma\.com/i.test(l)) ?? links[0] ?? ''

/** Apps a page URL can point at (the Defect workflow's "App" values that show up as a host name part). */
const APPS = ['core', 'client', 'app', 'expert', 'account']
/** Links in a ticket that are references, not the page with the defect. */
const NOT_A_PAGE = /(^|\.)(figma|clickup|slack|notion|loom|miro|atlassian)\.(com|so|net|io)$|(^|\.)(docs|drive)\.google\.com$|\.(png|jpe?g|gif|webp|svg|mp4|mov|pdf)$/i

/**
 * The page a defect happens on. Helix has no field for it; it is written in the ticket text, so take the
 * first link of the steps, actual and expected text (then the rest) that is not a PRD, Figma, document,
 * screenshot or Helix link. Empty when there is none. A person can correct it on the ticket.
 */
export function pageUrlFrom(ticket: HelixTicket): string {
  const known = new Set([...ticket.prdLinks, ...ticket.figmaLinks])
  const helixHost = new URL(ticket.url).host
  const text = [ticket.sections.steps_to_reproduce, ticket.sections.actual_behavior, ticket.sections.expected_behavior, ticket.description].filter(Boolean).join('\n')
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"'`]+/gi)) {
    const link = m[0].replace(/[.,;:!?]+$/, '')
    if (known.has(link)) continue
    try {
      const url = new URL(link)
      if (url.host === helixHost || NOT_A_PAGE.test(url.hostname) || NOT_A_PAGE.test(url.pathname)) continue
      return link
    } catch {}
  }
  return ''
}

/** The app from a page URL when its host says so (`core.example.com` → `core`); empty when it does not. */
export function appFromUrl(pageUrl: string): string {
  try {
    const labels = new URL(pageUrl).hostname.split('.')
    return labels.find((l) => APPS.includes(l.toLowerCase()))?.toLowerCase() ?? ''
  } catch {
    return ''
  }
}

export type TransferInput = {
  title: string
  description: string
  priority: string
  kind: 'task' | 'defect'
  repoId: string | null
  workflowId: string | null
  values: Record<string, string>
}

/** What a Helix ticket becomes on our board: a TaskInput (plus where it came from). */
export function toTaskInput(ticket: HelixTicket, mappings: Mappings, workflowIds: { planning: string | null; defect: string | null }, repoId: string | null): TransferInput {
  const figma = pickFigma(ticket.figmaLinks)
  const prd = ticket.prdLinks[0] ?? ''
  // Links beyond the first PRD / Figma are "other references".
  const others = [...ticket.prdLinks.filter((l) => l !== prd), ...ticket.figmaLinks.filter((l) => l !== figma)]
  const common = { title: ticket.title, priority: ticket.priority ?? '', kind: ticket.kind, repoId }

  if (ticket.kind === 'defect') {
    const pageUrl = pageUrlFrom(ticket)
    return {
      ...common,
      description: ticket.description,
      workflowId: workflowIds.defect,
      values: {
        defect: slug(ticket.title),
        environment: mappings.environment[ticket.type] ?? '',
        severity: mappings.severity[ticket.severity ?? ''] ?? '',
        url_page: pageUrl,
        app: appFromUrl(pageUrl),
        iteration: ticket.iteration ?? '',
        steps: ticket.sections.steps_to_reproduce ?? '',
        expected: ticket.sections.expected_behavior ?? '',
        actual: ticket.sections.actual_behavior ?? '',
        // A defect keeps every link it came with.
        references: [prd, figma, ...others].filter(Boolean).join('\n'),
      },
    }
  }
  const extra = others.length ? `\n\n## Other references\n\n${others.map((l) => `- ${l}`).join('\n')}` : ''
  return {
    ...common,
    description: ticket.description + extra,
    workflowId: workflowIds.planning,
    // Module is not in the ticket; the readiness badge asks for it.
    values: { prd, figma, iteration: ticket.iteration ?? '', module: '' },
  }
}
