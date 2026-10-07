import { evalCondition } from "./conditions";
import { seededNoise } from "./rng";
import type { LifeSim } from "./engine";
import type { WorldLaw } from "./types";

/**
 * Declarative world laws: passive yearly rules supplied by packs.
 *
 * This is the lifesim port of EraLife's data-driven simulation laws and
 * temporal-slice transforms, reduced to this engine's turn-based model. The
 * key property is **stream isolation**: a law resolves its randomness from
 * `seededNoise(seed, …)` rather than `sim.rng()`, so adding, removing or
 * retuning laws never advances the event RNG. State changes made by laws can
 * still affect event eligibility and outcomes.
 */

/** True when a law's age window and cadence line up with `age`. */
export function lawIsDue(law: WorldLaw, age: number): boolean {
  const min = law.minAge ?? 0;
  const max = law.maxAge ?? Infinity;
  const every = Math.max(1, law.everyYears ?? 1);
  if (age < min || age >= max) return false;
  return (age - min) % every === 0;
}

/** Resolve a law's `chance` (0..100) using stream-isolated seeded noise. */
export function lawFires(law: WorldLaw, sim: LifeSim): boolean {
  const chance = law.chance ?? 100;
  if (chance >= 100) return true;
  if (chance <= 0) return false;
  return seededNoise(sim.seed, "law", law.id, sim.character.age) * 100 < chance;
}

/**
 * Apply every due, eligible world law for the current year. Called from the
 * engine's passive tick. Returns the life-log notes for laws that speak.
 */
export function applyWorldLaws(sim: LifeSim): string[] {
  const notes: string[] = [];
  const c = sim.character;

  for (const law of sim.laws.values()) {
    if (!c.alive) break;
    if (!lawIsDue(law, c.age)) continue;
    if (!evalCondition(law.conditions, c)) continue;
    if (!lawFires(law, sim)) continue;

    if (law.effects?.length) sim.applyEffects(law.effects);

    for (const [index, d] of (law.drift ?? []).entries()) {
      const jitter = d.jitter ?? 0;
      const spread =
        jitter > 0
          ? (seededNoise(sim.seed, "drift", law.id, d.stat, index, c.age) * 2 - 1) * jitter
          : 0;
      const delta = Math.round(d.amount + spread);
      if (delta !== 0) sim.applyEffects([{ kind: "stat", stat: d.stat, delta }]);
    }

    if (!law.silent) {
      const label = law.title ?? law.description;
      if (label) notes.push(label);
    }
    if (!c.alive) break;
  }

  return notes;
}
