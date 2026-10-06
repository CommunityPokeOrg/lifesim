/**
 * Core domain types for the lifesim engine.
 *
 * Everything the engine consumes is plain JSON data — a mod pack never
 * contains executable code. The engine interprets conditions, weights and
 * effects declaratively, which is what makes packs safe to sandbox.
 */

/** Bounded 0..100 stats. Money is tracked separately (unbounded). */
export const STAT_KEYS = ["health", "happiness", "smarts", "looks"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export type Stats = Record<StatKey, number>;

export interface Character {
  name: string;
  age: number;
  stats: Stats;
  money: number;
  traits: string[];
  /** Free-form state set by events: in_school, employed, partner, in_prison… */
  flags: Record<string, unknown>;
  /** eventId -> choiceId history, used by `chose` conditions and `once`. */
  history: Record<string, string>;
  /** Events that already fired and may not fire again. */
  firedOnce: string[];
  /** eventId -> age at which it last fired, used by `cooldown`. */
  lastFired: Record<string, number>;
  /** eventId -> times fired, used by `repeatDecay`. */
  firedCount: Record<string, number>;
  alive: boolean;
  deathCause?: string;
}

/* ---------------------------------- packs ---------------------------------- */

export type CompareOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";

/**
 * Conditions are a small expression tree. `all`/`any`/`not` compose; the
 * leaves check age, stats, traits, flags and past choices.
 */
export type Condition =
  | { kind: "all"; conditions: Condition[] }
  | { kind: "any"; conditions: Condition[] }
  | { kind: "not"; condition: Condition }
  | { kind: "age"; min?: number; max?: number }
  | { kind: "stat"; stat: StatKey; op?: CompareOp; value: number }
  | { kind: "money"; op?: CompareOp; value: number }
  | { kind: "trait"; trait: string }
  | { kind: "flag"; flag: string; equals?: unknown }
  | { kind: "chose"; event: string; choice: string }
  /** Numeric compare on a counter flag (counters are set by `counter` effects). */
  | { kind: "counter"; flag: string; op?: CompareOp; value: number };

export interface WeightModifier {
  /** Only applies when this condition holds. */
  when: Condition;
  /** Multiplies the base weight (default 1). */
  multiply?: number;
  /** Adds to the base weight after multipliers (default 0). */
  add?: number;
}

export type Effect =
  | { kind: "stat"; stat: StatKey; delta: number }
  | { kind: "money"; delta: number }
  | { kind: "trait"; trait: string; action: "add" | "remove" }
  | { kind: "flag"; flag: string; value: unknown }
  | { kind: "unflag"; flag: string }
  | { kind: "counter"; flag: string; delta: number }
  /** Move a counter flag's value into money and zero it (liquidate savings). */
  | { kind: "collect"; flag: string }
  /** Remove an owned shop item (and its item_<id> flag). */
  | { kind: "loseitem"; item: string }
  | { kind: "die"; cause: string };

export interface Outcome {
  /** Base relative probability of this outcome branch. */
  weight: number;
  /** Stat/trait/history driven probability tweaks. */
  weightModifiers?: WeightModifier[];
  /** Applied when this branch is picked. */
  effects?: Effect[];
  /** Narration appended to the life log. */
  result: string;
  /** Optional chained event that resolves immediately after this one. */
  goto?: string;
}

export interface Choice {
  id: string;
  text: string;
  /** If present and false, the choice is hidden. */
  conditions?: Condition;
  /** Weighted branches; exactly one is picked. Omit for a single fixed outcome. */
  outcomes?: Outcome[];
  /** Shorthand for a single fixed outcome. */
  effects?: Effect[];
  result?: string;
  goto?: string;
}

export interface SimEvent {
  id: string;
  title: string;
  description: string;
  category?: string;
  /** Gate: all conditions must hold for the event to be eligible. */
  conditions?: Condition;
  /** Base draw weight (higher = more common). Default 10. */
  weight?: number;
  weightModifiers?: WeightModifier[];
  /** Fire at most once per life. */
  once?: boolean;
  /** Minimum years between firings (e.g. 4 = at most every 4th year). */
  cooldown?: number;
  /** Guaranteed: when eligible, always queues instead of rolling the draw. */
  forced?: boolean;
  /** Repeat dampening: effective weight is multiplied by this once per past
   *  firing (0..1, default 1 = no dampening). 0.5 halves the draw weight after
   *  each firing, so a repeated event grows steadily rarer instead of firing
   *  on a fixed cadence. */
  repeatDecay?: number;
  /** Choices offered to the player. Must be non-empty. */
  choices: Choice[];
  /** Editor layout metadata — ignored by the engine. */
  ui?: { x: number; y: number };
}

export interface EventPack {
  id: string;
  name: string;
  version: string;
  description?: string;
  events: SimEvent[];
  /** Optional player-initiated actions (casino, life choices…). */
  actions?: GameAction[];
  /** Optional purchasable items for the shop. */
  items?: ShopItem[];
  /** Optional jobs the character can apply for. */
  jobs?: Job[];
  /** Optional declarative world laws: passive yearly rules (inflation,
   *  decay, era drift…) applied every year without an event. */
  laws?: WorldLaw[];
}

/* ------------------------------- actions ------------------------------- */

/**
 * A player-initiated action on the play screen. Conditions gate availability
 * (age, education, flags, past choices — same DSL as events). Resolves like
 * an event choice: optional weighted `outcomes`, `effects`, and `goto` chains
 * into the event pool, so actions can trigger pack events.
 */
export interface GameAction {
  id: string;
  title: string;
  description?: string;
  /** UI grouping: "casino", "life", "work", or a custom label. */
  category?: string;
  conditions?: Condition;
  /** Money charged up front (may push money negative if `allowDebt`). */
  cost?: number;
  /** Allow the cost to take money below zero (debt). Default false. */
  allowDebt?: boolean;
  /** Max uses per year. Default 1. */
  usesPerYear?: number;
  /** Usable at most once per life. */
  once?: boolean;
  /** Counts against the per-year action budget. Default: only "life"
   *  category actions consume budget. */
  usesBudget?: boolean;
  outcomes?: Outcome[];
  effects?: Effect[];
  result?: string;
  goto?: string;
  /** Cosmetic hint shown when conditions aren't met ("needs a degree"). */
  hint?: string;
}

/** A purchasable shop item with lasting effects. */
export interface ShopItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  /** Gate: e.g. a car requires a minimum age. */
  conditions?: Condition;
  /** Can be re-bought (consumable). Default: own at most one. */
  repeatable?: boolean;
  /** Max purchases per year (repeatable items only). */
  usesPerYear?: number;
  /** Applied once on purchase. */
  effects?: Effect[];
  /** Applied every year while owned (item keeps paying off). */
  passiveEffects?: Effect[];
  hint?: string;
}

/** A job the character can apply for via the actions panel. */
export interface Job {
  id: string;
  title: string;
  /** Salary paid per year by the engine's passive tick. */
  salary: number;
  description?: string;
  /** Gate on age, education, flags, past choices, items, stats… */
  conditions?: Condition;
  /** Base hire chance 0-100 (default 65), adjusted by `hireModifiers`. */
  hireWeight?: number;
  hireModifiers?: WeightModifier[];
  hint?: string;
}

/* ------------------------------- world laws ------------------------------- */

/**
 * A declarative, data-only yearly rule. Unlike an event, a law has no
 * choices: when its cadence and conditions line up it simply applies its
 * effects (and/or stat drift) to the character. Laws are how a pack makes
 * the world feel like it moves on its own — cost-of-living inflation, slow
 * health decay, era transitions, fame cooling off.
 *
 * Randomness inside a law is stream-isolated: `chance` and `drift.jitter`
 * resolve from deterministic seeded noise keyed on (seed, law id, age),
 * never from the simulation RNG. Adding or tuning a law therefore cannot
 * perturb which events fire.
 */
export interface WorldLaw {
  id: string;
  /** Short label written to the life log when the law fires. */
  title?: string;
  description?: string;
  /** Gate: all conditions must hold (same DSL as events). */
  conditions?: Condition;
  /** First age the law can fire (the cadence anchor). Default 0. */
  minAge?: number;
  /** Exclusive upper age bound. Default unbounded. */
  maxAge?: number;
  /** Fire when (age - minAge) is a multiple of this. Default 1 (every year). */
  everyYears?: number;
  /** Probability 0..100 the law fires on a due year. Default 100. */
  chance?: number;
  /** Effects applied when the law fires (same DSL as events). */
  effects?: Effect[];
  /** Numeric per-stat drift applied when the law fires. */
  drift?: StatDrift[];
  /** Suppress the life-log line for this law. */
  silent?: boolean;
}

/** Mean + deterministic jitter for a single stat, applied by a world law. */
export interface StatDrift {
  stat: StatKey;
  /** Mean change per firing (may be negative). */
  amount: number;
  /** Deterministic ± spread around `amount`. Default 0. */
  jitter?: number;
}

/* --------------------------------- runtime --------------------------------- */

export interface PendingEvent {
  event: SimEvent;
  /** Choices after filtering by their conditions. */
  choices: Choice[];
}

export interface LogEntry {
  age: number;
  text: string;
  kind: "year" | "event" | "result" | "death" | "birth";
}
