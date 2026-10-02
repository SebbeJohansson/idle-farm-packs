// Copied from Idle Farm (app/game/digger/ and scripts/digger-pack.ts).
// The game applies these same rules on import; keep the copies in step.

// Content schema for the digger (see digger-plan.md, "Content schema").
//
// Everything a biome is made of — blocks, ores, creatures, harvestables — is
// plain data described here. Built-in biomes, stub-generated ones and (later)
// AI-generated or community-pack ones all pass through the same validator
// before the world is allowed to use them, so a malformed pack can never
// reach world generation.
//
// Stats are relative on purpose (`hardness: 'soft'`, `threat: 2`): the game
// turns them into real numbers by depth (see depthMultiplier in world.ts),
// so the same biome plays easy shallow and hard deep. Balance lives in code,
// never in content.

export const DIGGER_SCHEMA_VERSION = 1

export const HARDNESSES = ['soft', 'medium', 'hard'] as const
export type Hardness = typeof HARDNESSES[number]

export const RARITIES = ['common', 'rare', 'legendary'] as const
export type Rarity = typeof RARITIES[number]

export const BEHAVIORS = ['passive', 'territorial', 'hunter'] as const
export type Behavior = typeof BEHAVIORS[number]

export const PREFERRED_DEPTHS = ['shallow', 'mid', 'deep', 'any'] as const
export type PreferredDepth = typeof PREFERRED_DEPTHS[number]

export const HARVEST_KINDS = ['seed', 'soil', 'critter'] as const
export type HarvestKind = typeof HARVEST_KINDS[number]

// Not in the original plan's field list: how world generation schedules a
// biome. `breather` biomes are calm ones slotted in every few biomes,
// `landmark` biomes are hand-made anchors at fixed depths (see world.ts).
export const BIOME_ROLES = ['normal', 'breather', 'landmark'] as const
export type BiomeRole = typeof BIOME_ROLES[number]

// The emoji is required so every renderer, down to plain text, can draw the
// entity; the sprite is optional and the sprite renderer falls back to the
// emoji without one.
export interface Visual {
  emoji: string
  sprite?: string
}

interface EntityBase {
  id: string
  name: string
  visual: Visual
  // One or two sentences for the discovery journal.
  lore?: string
}

export interface BlockDef extends EntityBase {
  hardness: Hardness
}

export interface OreDef extends EntityBase {
  rarity: Rarity
}

export interface CreatureDef extends EntityBase {
  threat: 1 | 2 | 3 | 4 | 5
  behavior: Behavior
}

export interface HarvestableDef extends EntityBase {
  kind: HarvestKind
}

export interface BiomeDef {
  schemaVersion: number
  id: string
  name: string
  mood: string
  // '#rrggbb' — the base tile color. Renderers darken it with depth.
  palette: string
  preferredDepth: PreferredDepth
  role: BiomeRole
  blocks: BlockDef[]
  ores: OreDef[]
  creatures: CreatureDef[]
  harvestables: HarvestableDef[]
  lore: string
}

export interface PackDef {
  schemaVersion: number
  id: string
  name: string
  author: string
  version: string
  license: string
  // Semver range of game versions the pack was made for, e.g. ">=0.20.0".
  gameVersions: string
  biomes: BiomeDef[]
}

export type ValidationResult<T> = { ok: true, value: T } | { ok: false, errors: string[] }

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
const HEX_PATTERN = /^#[0-9a-f]{6}$/i
// Long enough for a ZWJ sequence (🧑‍🌾 is 5 code units), short enough that a
// "visual" can't smuggle a paragraph of text into a tile.
const MAX_EMOJI_LENGTH = 16
const MAX_TEXT_LENGTH = 400

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })

// Exactly one emoji, as a person sees it: one grapheme (so ZWJ sequences
// like 🧑‍🌾 and keycaps like 1️⃣ count as one) that is actually pictographic.
// Keeps generated content from drawing a tile as "A", "💎💎" or a word.
export function isSingleEmoji(text: string): boolean {
  return [...graphemes.segment(text)].length === 1
    && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(text)
}

// Collects every problem instead of stopping at the first, so a pack author
// (or the AI pipeline's retry loop) sees the whole list at once.
class Checker {
  errors: string[] = []

  fail(path: string, message: string) {
    this.errors.push(`${path}: ${message}`)
  }

  object(value: unknown, path: string): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>
    this.fail(path, 'must be an object')
    return null
  }

  text(value: unknown, path: string, max = MAX_TEXT_LENGTH): string {
    if (typeof value === 'string' && value.trim().length > 0 && value.length <= max)
      return value
    this.fail(path, `must be a non-empty string of at most ${max} characters`)
    return ''
  }

  id(value: unknown, path: string): string {
    if (typeof value === 'string' && ID_PATTERN.test(value))
      return value
    this.fail(path, 'must be a lowercase id (a-z, 0-9, dashes, max 40)')
    return ''
  }

  oneOf<T extends string>(value: unknown, options: readonly T[], path: string): T {
    if (typeof value === 'string' && (options as readonly string[]).includes(value))
      return value as T
    this.fail(path, `must be one of ${options.join(', ')}`)
    return options[0]!
  }

  list(value: unknown, path: string, min: number, max: number): unknown[] {
    if (Array.isArray(value) && value.length >= min && value.length <= max)
      return value
    this.fail(path, `must be a list of ${min}–${max} entries`)
    return Array.isArray(value) ? value : []
  }

  visual(value: unknown, path: string): Visual {
    const raw = this.object(value, path)
    const emoji = this.text(raw?.emoji, `${path}.emoji`, MAX_EMOJI_LENGTH)
    if (emoji && !isSingleEmoji(emoji))
      this.fail(`${path}.emoji`, `must be exactly one emoji, got "${emoji}"`)
    const visual: Visual = { emoji }
    if (raw?.sprite !== undefined) {
      if (typeof raw.sprite === 'string' && /^[\w./-]+\.png$/.test(raw.sprite) && !raw.sprite.includes('..'))
        visual.sprite = raw.sprite
      else
        this.fail(`${path}.sprite`, 'must be a relative .png path inside the pack')
    }
    return visual
  }

  entityBase(raw: Record<string, unknown>, path: string): EntityBase {
    const base: EntityBase = {
      id: this.id(raw.id, `${path}.id`),
      name: this.text(raw.name, `${path}.name`, 40),
      visual: this.visual(raw.visual, `${path}.visual`),
    }
    if (raw.lore !== undefined)
      base.lore = this.text(raw.lore, `${path}.lore`)
    return base
  }

  schemaVersion(value: unknown, path: string): number {
    if (value === DIGGER_SCHEMA_VERSION)
      return value
    this.fail(path, `must be ${DIGGER_SCHEMA_VERSION}`)
    return DIGGER_SCHEMA_VERSION
  }
}

function checkUniqueIds(check: Checker, entities: { id: string }[], path: string) {
  const seen = new Set<string>()
  for (const { id } of entities) {
    if (id && seen.has(id))
      check.fail(path, `duplicate id "${id}"`)
    seen.add(id)
  }
}

function readBiome(check: Checker, value: unknown, path: string): BiomeDef {
  const raw = check.object(value, path) ?? {}
  const blocks = check.list(raw.blocks, `${path}.blocks`, 4, 6).map((entry, i): BlockDef => {
    const r = check.object(entry, `${path}.blocks[${i}]`) ?? {}
    return { ...check.entityBase(r, `${path}.blocks[${i}]`), hardness: check.oneOf(r.hardness, HARDNESSES, `${path}.blocks[${i}].hardness`) }
  })
  const ores = check.list(raw.ores, `${path}.ores`, 1, 4).map((entry, i): OreDef => {
    const r = check.object(entry, `${path}.ores[${i}]`) ?? {}
    return { ...check.entityBase(r, `${path}.ores[${i}]`), rarity: check.oneOf(r.rarity, RARITIES, `${path}.ores[${i}].rarity`) }
  })
  const creatures = check.list(raw.creatures, `${path}.creatures`, 1, 3).map((entry, i): CreatureDef => {
    const r = check.object(entry, `${path}.creatures[${i}]`) ?? {}
    const threat = Number(r.threat)
    if (!Number.isInteger(threat) || threat < 1 || threat > 5)
      check.fail(`${path}.creatures[${i}].threat`, 'must be a whole number from 1 to 5')
    return {
      ...check.entityBase(r, `${path}.creatures[${i}]`),
      threat: Math.min(5, Math.max(1, Math.round(threat) || 1)) as CreatureDef['threat'],
      behavior: check.oneOf(r.behavior, BEHAVIORS, `${path}.creatures[${i}].behavior`),
    }
  })
  const harvestables = check.list(raw.harvestables, `${path}.harvestables`, 1, 3).map((entry, i): HarvestableDef => {
    const r = check.object(entry, `${path}.harvestables[${i}]`) ?? {}
    return { ...check.entityBase(r, `${path}.harvestables[${i}]`), kind: check.oneOf(r.kind, HARVEST_KINDS, `${path}.harvestables[${i}].kind`) }
  })

  // Ids share one namespace per biome: journal keys are `<biome>/<entity>`.
  checkUniqueIds(check, [...blocks, ...ores, ...creatures, ...harvestables], path)
  if (!ores.some(ore => ore.rarity === 'common'))
    check.fail(`${path}.ores`, 'needs at least one common ore, so every biome pays something')

  const palette = typeof raw.palette === 'string' && HEX_PATTERN.test(raw.palette) ? raw.palette.toLowerCase() : ''
  if (!palette)
    check.fail(`${path}.palette`, 'must be a #rrggbb color')

  return {
    schemaVersion: check.schemaVersion(raw.schemaVersion, `${path}.schemaVersion`),
    id: check.id(raw.id, `${path}.id`),
    name: check.text(raw.name, `${path}.name`, 40),
    mood: check.text(raw.mood, `${path}.mood`, 80),
    palette,
    preferredDepth: check.oneOf(raw.preferredDepth, PREFERRED_DEPTHS, `${path}.preferredDepth`),
    role: raw.role === undefined ? 'normal' : check.oneOf(raw.role, BIOME_ROLES, `${path}.role`),
    blocks,
    ores,
    creatures,
    harvestables,
    lore: check.text(raw.lore, `${path}.lore`),
  }
}

export function validateBiome(value: unknown): ValidationResult<BiomeDef> {
  const check = new Checker()
  const biome = readBiome(check, value, 'biome')
  return check.errors.length ? { ok: false, errors: check.errors } : { ok: true, value: biome }
}

export function validatePack(value: unknown): ValidationResult<PackDef> {
  const check = new Checker()
  const raw = check.object(value, 'pack') ?? {}
  const biomes = check.list(raw.biomes, 'pack.biomes', 1, 200)
    .map((entry, i) => readBiome(check, entry, `pack.biomes[${i}]`))
  checkUniqueIds(check, biomes, 'pack.biomes')
  const pack: PackDef = {
    schemaVersion: check.schemaVersion(raw.schemaVersion, 'pack.schemaVersion'),
    id: check.id(raw.id, 'pack.id'),
    name: check.text(raw.name, 'pack.name', 60),
    author: check.text(raw.author, 'pack.author', 60),
    version: check.text(raw.version, 'pack.version', 20),
    license: check.text(raw.license, 'pack.license', 40),
    gameVersions: check.text(raw.gameVersions, 'pack.gameVersions', 40),
    biomes,
  }
  return check.errors.length ? { ok: false, errors: check.errors } : { ok: true, value: pack }
}
