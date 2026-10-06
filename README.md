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

## Project layout

```
src/
  engine/    types, condition evaluator, weighted RNG, LifeSim, zod schema
  packs/     bundled JSON event packs
  game/      playable UI (stat bars, event card, life log)
  editor/    React Flow mod editor + pack import/export
```
