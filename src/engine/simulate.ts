import { LifeSim } from "./engine";
import type { EventPack } from "./types";

/**
 * Batch simulation helper: plays out many lives to completion and gathers
 * per-event firing statistics. Used by the distribution regression test and
 * by scripts/distribution-report.ts for manual audits.
 *
 * Deterministic: life `i` runs on seed `seedBase + i`, and the default
 * choice policy picks uniformly among the offered choices using the sim's
 * own seeded RNG.
 */

export type ChoicePolicy = (sim: LifeSim) => string;

/** Pick uniformly at random among the pending choices (uses the sim's RNG). */
export const randomPolicy: ChoicePolicy = (sim) => {
  const choices = sim.pending!.choices;
  return choices[Math.floor(sim.rng() * choices.length)].id;
};

/** Always pick the first offered choice. */
export const firstChoicePolicy: ChoicePolicy = (sim) => sim.pending!.choices[0].id;

export interface EventStats {
  id: string;
  /** Lives (0..1) in which the event fired at least once. */
  lifeRate: number;
  /** Total times it fired across all lives. */
  fires: number;
  /** Mean fires per life. */
  perLife: number;
  /** Most times it fired inside a single life. */
  maxPerLife: number;
  /** Share of all event fires (0..1). */
  share: number;
  /** Per-year fire rate conditioned on the event being eligible that year.
   *  Only counts eligible years where the event had weight > 0. */
  rateWhenEligible: number;
  /** Eligible years with weight > 0, summed across lives. */
  eligibleYears: number;
  /** Mean / min / max age at firing. */
  meanAge: number;
  minAge: number;
  maxAge: number;
}

export interface SimReport {
  lives: number;
  /** Total years lived across all lives (one event draw opportunity each). */
  totalYears: number;
  /** Years where no event was drawn (quiet years). */
  quietYears: number;
  /** Total pending events presented (drawn + chained via goto). */
  totalFires: number;
  /** Mean events per life. */
  eventsPerLife: number;
  /** Mean lifespan. */
  meanAge: number;
  /** Lives (0..1) where start_school never fired. */
  neverSchooled: number;
  /** Lives (0..1) where graduation never fired despite schooling. */
  neverGraduated: number;
  /** Lives (0..1) that were employed at some point. */
  everEmployed: number;
  /** Lives (0..1) that married. */
  everMarried: number;
  /** Lives (0..1) that spent time in prison. */
  everPrison: number;
  events: Map<string, EventStats>;
}

export interface SimOptions {
  lives: number;
  packs: EventPack[];
  policy?: ChoicePolicy;
  seedBase?: number;
  /** Safety cap on years per life. */
  maxYears?: number;
}

export function simulate(opts: SimOptions): SimReport {
  const policy = opts.policy ?? randomPolicy;
  const seedBase = opts.seedBase ?? 0;
  const maxYears = opts.maxYears ?? 130;

  const fires = new Map<string, number>();
  const livesWith = new Map<string, number>();
  const eligibleYears = new Map<string, number>();
  const fireAges = new Map<string, number[]>();
  const maxPerLife: Record<string, number> = {};

  let totalYears = 0;
  let quietYears = 0;
  let totalFires = 0;
  let totalAge = 0;
  let neverSchooled = 0;
  let neverGraduated = 0;
  let everEmployed = 0;
  let everMarried = 0;
  let everPrison = 0;

  for (let i = 0; i < opts.lives; i++) {
    const sim = new LifeSim(opts.packs, { seed: seedBase + i, name: `Life${i}` });
    const counts = new Map<string, number>();
    // The pending event counted this tick; avoids double counting while
    // still counting chained goto events (each becomes pending once).
    let countedPending: unknown = null;
    let sawEmployed = false;
    let sawMarried = false;
    let sawPrison = false;

    while (sim.character.alive && sim.character.age < maxYears) {
      sawEmployed = sawEmployed || sim.character.flags.employed === true;
      sawMarried = sawMarried || sim.character.flags.married === true;
      sawPrison = sawPrison || sim.character.flags.in_prison === true;
      if (sim.pending) {
        if (sim.pending !== countedPending) {
          countedPending = sim.pending;
          const id = sim.pending.event.id;
          fires.set(id, (fires.get(id) ?? 0) + 1);
          counts.set(id, (counts.get(id) ?? 0) + 1);
          (fireAges.get(id) ?? fireAges.set(id, []).get(id)!).push(sim.character.age);
          totalFires++;
        }
        sim.resolve(policy(sim));
        continue;
      }
      countedPending = null;
      sim.ageUp();
      totalYears++;
      if (!sim.character.alive) break;
      // Eligibility at draw time: ageUp already applied the passive tick, so
      // this reflects the same state the draw used (once/firedOnce is only
      // consumed on resolve, so a just-drawn event still reads eligible).
      for (const { event, weight } of sim.eligibleEvents()) {
        if (weight > 0) {
          eligibleYears.set(event.id, (eligibleYears.get(event.id) ?? 0) + 1);
        }
      }
      if (!sim.pending) quietYears++;
    }

    if (!sim.character.firedOnce.includes("start_school")) neverSchooled++;
    if (sim.character.firedOnce.includes("start_school") && !sim.character.history["graduation"]) {
      neverGraduated++;
    }
    if (sawEmployed) everEmployed++;
    if (sawMarried) everMarried++;
    if (sawPrison) everPrison++;
    for (const [id, n] of counts) {
      livesWith.set(id, (livesWith.get(id) ?? 0) + 1);
      maxPerLife[id] = Math.max(maxPerLife[id] ?? 0, n);
    }
    totalAge += sim.character.age;
  }

  const events = new Map<string, EventStats>();
  for (const id of new Set([...fires.keys(), ...eligibleYears.keys()])) {
    const f = fires.get(id) ?? 0;
    const ey = eligibleYears.get(id) ?? 0;
    const a = fireAges.get(id) ?? [];
    const meanAge = a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
    events.set(id, {
      id,
      lifeRate: (livesWith.get(id) ?? 0) / opts.lives,
      fires: f,
      perLife: f / opts.lives,
      maxPerLife: maxPerLife[id] ?? 0,
      share: totalFires ? f / totalFires : 0,
      rateWhenEligible: ey ? f / ey : 0,
      eligibleYears: ey,
      meanAge,
      minAge: a.length ? Math.min(...a) : 0,
      maxAge: a.length ? Math.max(...a) : 0,
    });
  }

  return {
    lives: opts.lives,
    totalYears,
    quietYears,
    totalFires,
    eventsPerLife: totalFires / opts.lives,
    meanAge: totalAge / opts.lives,
    neverSchooled: neverSchooled / opts.lives,
    neverGraduated: neverGraduated / opts.lives,
    everEmployed: everEmployed / opts.lives,
    everMarried: everMarried / opts.lives,
    everPrison: everPrison / opts.lives,
    events,
  };
}
