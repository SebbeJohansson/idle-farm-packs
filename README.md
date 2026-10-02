# Idle Farm packs

The registry of community biome packs for Idle Farm's digger. The game's
**Shop → Packs → Browse packs** reads [`index.json`](index.json) from here
(through jsDelivr) and installs a pack only if its file matches the checksum
listed for it.

## Add your pack

Start from [idle-farm-pack-template](https://github.com/SebbeJohansson/idle-farm-pack-template):
it explains how to write a pack, check it, tag a release and print your
entry. Then open a pull request that adds the entry to `packs` in
`index.json`:

```json
{
  "id": "your-pack-id",
  "name": "Your Pack",
  "author": "You",
  "description": "One line about it.",
  "version": "1.0.0",
  "license": "CC0-1.0",
  "biomes": 3,
  "url": "https://cdn.jsdelivr.net/gh/<you>/<repo>@v1.0.0/pack.json",
  "sha256": "sha256-…"
}
```

CI downloads the file and checks it matches the `sha256`, `id`, `version`,
`license` and biome count, and passes the game's pack rules. To update a
pack, tag a new release and change `version`, `url` and `sha256`.

Run the same check locally with Node 22.18 or newer: `npm run check`.

## Reports and removals

Players can report a pack from the game; that opens a
[Report a pack](../../issues/new?template=report-pack.yml) issue here. A
pack that has to go is removed from `packs` and its id added to `blocked`:
the game stops listing it and warns anyone who has it installed.
Every push to `main` clears jsDelivr's cache of `index.json`, so changes
reach players right away.

## tools/

Copies of the game's pack rules (`schema.ts`) and registry reader
(`registry.ts`), plus `check-registry.ts`. Plain Node, no dependencies.

## License

The tools and this repo's files are [MIT](LICENSE). Each pack belongs to
its author and is under the license listed in its entry.
