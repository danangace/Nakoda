import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod/v4'
import { nakodaHome } from '../config'

/**
 * Tokens live in `~/.nakoda/secrets.json` (mode 600), never in the database (that file is 644) and
 * never in anything sent to the browser. Shape: `{ "connections": { "<id>": { "token": "…", "writeToken": "…" } } }`;
 * `token` reads, `writeToken` (optional) is the separate one that may change tickets.
 */
const Entry = z.object({ token: z.string().optional(), writeToken: z.string().optional() })
type Entry = z.infer<typeof Entry>
const SecretsFile = z.object({ connections: z.record(z.string(), Entry).default({}) })
type Secrets = z.infer<typeof SecretsFile>

export class SecretStore {
  readonly file: string

  constructor(dir = nakodaHome()) {
    this.file = join(dir, 'secrets.json')
  }

  private read(): Secrets {
    if (!existsSync(this.file)) return { connections: {} }
    // A looser mode (copied from a backup, say) gets tightened before we trust or extend the file.
    if ((statSync(this.file).mode & 0o077) !== 0) chmodSync(this.file, 0o600)
    try {
      const parsed = SecretsFile.safeParse(JSON.parse(readFileSync(this.file, 'utf8')))
      return parsed.success ? parsed.data : { connections: {} }
    } catch {
      return { connections: {} }
    }
  }

  /** Atomic: write a 600 temp file next to it, then rename over the real one. */
  private write(secrets: Secrets): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  getToken(connectionId: string): string | null {
    return this.read().connections[connectionId]?.token ?? null
  }

  getWriteToken(connectionId: string): string | null {
    return this.read().connections[connectionId]?.writeToken ?? null
  }

  private change(connectionId: string, edit: (entry: Entry) => void): void {
    const secrets = this.read()
    const entry = { ...secrets.connections[connectionId] }
    edit(entry)
    if (entry.token === undefined && entry.writeToken === undefined) delete secrets.connections[connectionId]
    else secrets.connections[connectionId] = entry
    this.write(secrets)
  }

  setToken(connectionId: string, token: string): void {
    this.change(connectionId, (e) => void (e.token = token))
  }

  setWriteToken(connectionId: string, token: string): void {
    this.change(connectionId, (e) => void (e.writeToken = token))
  }

  /** Drops the read token only; a write token on the same connection stays. */
  deleteReadToken(connectionId: string): void {
    this.change(connectionId, (e) => void delete e.token)
  }

  deleteWriteToken(connectionId: string): void {
    this.change(connectionId, (e) => void delete e.writeToken)
  }

  /** Everything saved for the connection (it is being removed). */
  deleteToken(connectionId: string): void {
    this.change(connectionId, (e) => {
      delete e.token
      delete e.writeToken
    })
  }
}

const TOKEN_PATTERN = /sidpjm_[a-f0-9]{64}/g

/** Hide any Helix token inside text that may be logged or shown. */
export function redactTokens(text: string): string {
  return text.replace(TOKEN_PATTERN, 'sidpjm_…')
}

/** `sidpjm_…a1b2`: the last four characters only. */
export function tokenHint(token: string): string {
  return `sidpjm_…${token.slice(-4)}`
}
