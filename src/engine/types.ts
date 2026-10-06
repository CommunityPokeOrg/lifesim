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
  | { kind: "chose"; event: string; choice: string };

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
