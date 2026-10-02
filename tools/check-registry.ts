// Checks index.json the way the game reads it, then downloads every pack it
// lists and checks that too: the file matches its checksum, its id,
// version and biome count match the entry, and it passes the game's pack
// rules. CI runs this on every PR and once a day, so a pack file that
// disappears or changes is noticed.
//
//   node tools/check-registry.ts [index.json]

import { readFileSync } from 'node:fs'
import { readRegistry, sha256Of } from './registry.ts'
import { validatePack } from './schema.ts'

const path = process.argv[2] ?? 'index.json'
const raw = JSON.parse(readFileSync(path, 'utf8')) as { packs?: unknown[] }
const registry = readRegistry(raw)
if (!registry) {
  console.log(`✗ ${path} is not a registry file (schemaVersion 1, packs: [], blocked: [])`)
  process.exit(1)
}

let failed = 0
const fail = (message: string) => {
  failed++
  console.log(`✗ ${message}`)
}

const listed = raw.packs?.length ?? 0
if (registry.packs.length !== listed)
  fail(`${listed - registry.packs.length} of ${listed} entries are unreadable or blocked (every field is required, url must be https, sha256 as "sha256-<base64>")`)
const ids = registry.packs.map(p => p.id)
for (const id of new Set(ids)) {
  if (ids.filter(x => x === id).length > 1)
    fail(`pack id "${id}" is listed more than once`)
}

for (const entry of registry.packs) {
  const label = `${entry.id} (${entry.url})`
  try {
    if (!/^https:\/\/cdn\.jsdelivr\.net\/gh\/[^/]+\/[^/@]+@[^/]+\//.test(entry.url))
      fail(`${label}: url should be a tag-pinned jsDelivr link, https://cdn.jsdelivr.net/gh/<owner>/<repo>@<tag>/pack.json`)
    const res = await fetch(entry.url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) {
      fail(`${label}: answered ${res.status}`)
      continue
    }
    const bytes = await res.arrayBuffer()
    const sum = await sha256Of(bytes)
    if (sum !== entry.sha256)
      fail(`${label}: checksum is ${sum}, the entry says ${entry.sha256}`)
    const result = validatePack(JSON.parse(new TextDecoder().decode(bytes)))
    if (!result.ok) {
      fail(`${label}: ${result.errors.slice(0, 5).join('; ')}`)
      continue
    }
    const pack = result.value
    if (pack.id !== entry.id)
      fail(`${label}: the file's id is "${pack.id}"`)
    if (pack.version !== entry.version)
      fail(`${label}: the file's version is ${pack.version}, the entry says ${entry.version}`)
    if (pack.biomes.length !== entry.biomes)
      fail(`${label}: the file has ${pack.biomes.length} biomes, the entry says ${entry.biomes}`)
    if (pack.license !== entry.license)
      fail(`${label}: the file's license is ${pack.license}, the entry says ${entry.license}`)
    console.log(`✓ ${entry.id} ${entry.version} — "${entry.name}", ${entry.biomes} biomes`)
  }
  catch (error) {
    fail(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log(`${registry.packs.length} packs, ${registry.blocked.length} blocked${failed ? `, ${failed} problems` : ''}`)
process.exit(failed ? 1 : 0)
