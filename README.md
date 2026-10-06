# lifesim

A moddable, browser-based life simulator (BitLife-style) with a visual
node-graph mod editor. Built with TypeScript, Vite, React, and React Flow.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test           # engine unit tests (vitest)
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
```

## What's inside

- **Simulation engine** (`src/engine/`) — ages a character year by year with
  health, happiness, smarts, and looks stats (0–100), unbounded money, named
  traits, and free-form flags (`in_school`, `employed`, `partner`,
  `in_prison`, …). Each year applies passive effects (salary, schooling,
  prison sentences, age-related health drift), then draws one eligible event
  for the player to resolve. Deterministic per seed.
- **Data-driven event system** — events live in JSON *packs*, not in code.
  There is no hardcoded if-then event logic; the engine interprets a small
  declarative DSL:
  - **Conditions** on age, stats, money, traits, flags, and past choices
    (`all` / `any` / `not` trees).
  - **Weighted random branches** per choice (`outcomes`), plus weighted event
    draws each year.
  - **Probability modifiers** — `weightModifiers` multiply or add to weights
    when a condition holds (e.g. the `athletic` trait tilts fight outcomes).
  - **Effects** — stat deltas, money, trait add/remove, flag set/unset, death.
  - **`goto` chains** — an outcome can hand off to another event immediately.
  - **World laws** — passive yearly rules applied with no event (inflation,
    decay, era drift). See [World laws](#world-laws).
- **Visual mod editor** (`src/editor/`) — a React Flow node graph where each
  node is an event and each edge is a `goto` link from a specific choice.
  Click a node to edit title, conditions, choices, branches, effects, and
  weights in the inspector. Import/export packs as JSON and *Playtest* them
  instantly in the simulator.
- **Starter pack** (`src/packs/core.json`) — 17 events across school, jobs,
  relationships, crime, health, and luck.
- **Sandboxed packs** — packs are data-only. `validatePack` (zod schema +
  semantic checks: unique ids, dangling `goto`s, choices without outcomes) is
  run on every import, and the engine only interprets validated data — no
  `eval`, no code paths in pack files.

## Pack format

```jsonc
{
  "id": "my_pack",
  "name": "My Mod Pack",
  "version": "1.0.0",
  "events": [
    {
      "id": "big_test",
      "title": "Big test",
      "description": "Finals are tomorrow.",
      "category": "school",
      "weight": 15,                         // draw weight (default 10)
      "once": true,                         // at most once per life
      "cooldown": 2,                        // min years between firings
      "repeatDecay": 0.6,                   // each firing multiplies future weight
      // "forced": true                     // always queues when eligible (milestones)
      "conditions": {
        "kind": "all",
        "conditions": [
          { "kind": "age", "min": 14, "max": 22 },
          { "kind": "flag", "flag": "in_school", "equals": true }
        ]
      },
      "choices": [
        {
          "id": "cram",
          "text": "Cram all night",
          "outcomes": [                      // weighted random branches
            {
              "weight": 60,
              "weightModifiers": [           // stat-driven probability
                { "when": { "kind": "stat", "stat": "smarts", "op": "gte", "value": 70 },
                  "add": 30 }
              ],
              "effects": [{ "kind": "stat", "stat": "smarts", "delta": 5 }],
              "result": "You aced it."
            },
            { "weight": 40, "result": "You fell asleep on the desk." }
          ]
        },
        {
          "id": "skip",
          "text": "Skip it",
          "conditions": { "kind": "not", "condition": { "kind": "trait", "trait": "bookish" } },
          "effects": [{ "kind": "stat", "stat": "happiness", "delta": 4 }],
          "result": "Beach day."
        }
      ]
    }
  ]
}
```

See `src/engine/types.ts` for the full type definitions and
`src/engine/schema.ts` for the validation rules.

### World laws

Events need a player choice. **World laws** are the other half: passive,
data-only yearly rules the engine applies in its passive tick, with no
pending card. They are how a pack makes the world feel like it moves on its
own — cost-of-living inflation, slow health decay, era transitions, fame
cooling off.

```jsonc
{
  "id": "inflation",
  "title": "The cost of living rose.",   // life-log line (optional)
  "minAge": 18,                           // cadence anchor (default 0)
  "everyYears": 1,                        // fire every N years (default 1)
  "chance": 70,                           // 0..100, seeded (default 100)
  "conditions": { "kind": "flag", "flag": "employed", "equals": true },
  "drift": [{ "stat": "happiness", "amount": -1, "jitter": 1 }],
  "effects": [{ "kind": "money", "delta": -500 }]
}
```

- A law fires when `minAge <= age < maxAge` **and**
  `(age - minAge) % everyYears === 0`.
- `conditions` is the same DSL as events; `effects` is the same effect DSL
  (`stat`, `money`, `trait`, `flag`, `counter`, `collect`, `die`, …).
- `drift` is shorthand for per-stat change with optional deterministic
  `jitter`.
- A law needs at least one of `effects` or `drift`.

Randomness in a law (`chance` and `drift` jitter) is **stream-isolated**: it
comes from deterministic noise keyed on `(seed, law id, age)` rather than the
simulation RNG. Adding, removing or retuning a law therefore cannot change
which events fire, and a seeded life still replays exactly. (This mirrors the
temporal-slice `_seeded_unit_noise` used by EraLife.)

## Triggering & testing events

Each year the engine gathers every event whose `conditions` pass (and whose
`once`/`cooldown`/`repeatDecay` bookkeeping allows it), then draws one by
`weight` — with a "quiet year" dummy entry so some years have no event.
`forced: true` events skip the draw and always queue while eligible. A choice
outcome can `goto` another event id to chain it immediately (chain targets
conventionally use `weight: 0` so they only ever appear via `goto`).

Trigger-style examples:

- **Age/stats/money**: `{ "kind": "age", "min": 18 }`,
  `{ "kind": "money", "op": "gte", "value": 100000 }`
- **Flags set by earlier events**: `{ "kind": "flag", "flag": "conspiracist", "equals": true }`
  (the Total Chaos pack sets flags like `goose_enemy`, `internet_famous`,
  `crypto_stake` to unlock follow-ups)
- **Past choices**: `{ "kind": "chose", "event": "school_bully", "choice": "fight_back" }`
- **Compound**: wrap any of the above in `all` / `any` / `not`.

To force-test one event, edit the pack JSON: give the event `"forced": true`
and a narrow window, e.g. `"conditions": { "kind": "age", "min": 20, "max": 20 }`
— it then fires the year the character turns 20. For flag-gated events, also
relax the flag condition (or chain it from an event you can reach). You can
test in-game (Play tab → New life with a seed) or headlessly:

```bash
npx vitest run                 # engine + pack validation tests
npx vite-node scripts/distribution-report.ts 5000   # firing stats over N lives
```

The Mod Editor's *Playtest* button also drops your current graph into the
simulator as a temporary pack.

Bundled packs live in `src/packs/` and are registered in `src/App.tsx`
(`BUNDLED_PACKS`); each one gets a checkbox in the game's "Loaded packs"
panel. The bundled **Total Chaos Pack** (`src/packs/chaos.json`) adds ~40
absurd events — goose vendettas, viral fame, crypto prophets, haunted
inheritances — on top of the core pack. Untick it for a calmer life.

## Project layout

```
src/
  engine/    types, condition evaluator, weighted RNG, LifeSim, zod schema
  packs/     bundled JSON event packs
  game/      playable UI (stat bars, event card, life log)
  editor/    React Flow mod editor + pack import/export
```
