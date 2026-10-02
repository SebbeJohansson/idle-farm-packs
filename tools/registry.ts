// Copied from Idle Farm (app/game/digger/ and scripts/digger-pack.ts).
// The game applies these same rules on import; keep the copies in step.

// The community pack registry (digger-plan.md, "Community packs"): an
// `index.json` of approved packs, each pinned to a released file and its
// checksum, plus a blocklist of packs pulled after the fact. Submission is
// a PR to the registry repo, validated by `yarn digger-pack validate`.
//
// Framework-free like the rest of the digger: fetch and hashing go through
// the web platform (fetch, crypto.subtle), which Node has too, so scripts
// can use this as-is.

import type { PackDef } from './schema.ts'
import { DIGGER_SCHEMA_VERSION } from './schema.ts'

export const REGISTRY_SCHEMA_VERSION = 1

export interface RegistryEntry {
  // Must match the pack file's own `id`.
  id: string
  name: string
  author: string
  description: string
  version: string
  license: string
  biomes: number
  // The released pack file — pinned to a tag on jsDelivr, so it can't
  // change under the checksum.
  url: string
  // "sha256-<base64>", as `yarn digger-pack checksum` prints it.
  sha256: string
}

export interface Registry {
  schemaVersion: number
  packs: RegistryEntry[]
  // Pack ids pulled from the registry. The browser hides them, and an
  // installed copy is flagged so the player can remove it.
  blocked: string[]
}

const MAX_ENTRIES = 500

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null
}

// Same spirit as validatePack: anything off is dropped rather than trusted.
// One bad entry doesn't hide the rest of the registry.
export function readRegistry(raw: unknown): Registry | null {
  if (!raw || typeof raw !== 'object')
    return null
  const r = raw as Record<string, unknown>
  if (r.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(r.packs))
    return null
  const blocked = Array.isArray(r.blocked) ? r.blocked.filter((id): id is string => typeof id === 'string') : []
  const packs = r.packs.slice(0, MAX_ENTRIES).flatMap((entry): RegistryEntry[] => {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const id = text(e.id, 40)
    const name = text(e.name, 60)
    const author = text(e.author, 60)
    const version = text(e.version, 20)
    const license = text(e.license, 40)
    const url = text(e.url, 500)
    const sha256 = typeof e.sha256 === 'string' && /^sha256-[\w+/]{43}=$/.test(e.sha256) ? e.sha256 : null
    if (!id || !name || !author || !version || !license || !url || !sha256 || blocked.includes(id))
      return []
    // https only, or a same-site path (the dev registry).
    if (!/^https:\/\//.test(url) && !url.startsWith('/'))
      return []
    const biomes = Math.max(0, Math.floor(Number(e.biomes) || 0))
    return [{ id, name, author, description: text(e.description, 300) ?? '', version, license, biomes, url, sha256 }]
  })
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, packs, blocked }
}

export async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let binary = ''
  for (const b of digest) binary += String.fromCharCode(b)
  return `sha256-${btoa(binary)}`
}

export async function fetchRegistry(url: string): Promise<Registry> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-cache' })
  if (!res.ok)
    throw new Error(`the registry answered ${res.status}`)
  const registry = readRegistry(await res.json())
  if (!registry)
    throw new Error('the registry file isn\'t one this game version understands')
  return registry
}

// Downloads a pack and checks it is exactly the file the registry approved
// before anything reads it. The caller still imports it through
// importPack, which validates the content like any other pack.
export async function downloadPack(entry: RegistryEntry, base?: string): Promise<unknown> {
  const res = await fetch(base ? new URL(entry.url, base) : entry.url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok)
    throw new Error(`the pack file answered ${res.status}`)
  const bytes = await res.arrayBuffer()
  if (await sha256Of(bytes) !== entry.sha256)
    throw new Error('the file doesn\'t match the registry\'s checksum, so it wasn\'t installed')
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PackDef>
  if (raw?.id !== entry.id)
    throw new Error(`the file is pack "${String(raw?.id)}", not "${entry.id}"`)
  if (raw.schemaVersion !== DIGGER_SCHEMA_VERSION)
    throw new Error('the pack was made for a different game version')
  return raw
}

// Where an installed pack stands against the registry.
export type PackState = 'new' | 'installed' | 'update'

export function packState(entry: RegistryEntry, installed: readonly Pick<PackDef, 'id' | 'version'>[]): PackState {
  const mine = installed.find(p => p.id === entry.id)
  if (!mine)
    return 'new'
  return mine.version === entry.version ? 'installed' : 'update'
}
