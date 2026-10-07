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
  /** Persistent NPCs: family, friends, partners, coworkers, kids. */
  people: Person[];
  /** Active diseases/conditions. */
  ailments: ActiveAilment[];
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
  /**
   * Employment prerequisite. With no matchers it means "currently employed";
   * `id` matches the job's pack id, `title` the display title, `field` the
   * career track declared on the job def (e.g. "white_collar"). All supplied
   * matchers must hold. With `ever`, the condition checks the career record
   * (flags.job_history plus this life's hire history) instead of current
   * employment — use it for seniority ladders ("must have been an analyst").
   */
  | { kind: "job"; id?: string; title?: string; field?: string; ever?: boolean }
  /** Numeric compare on a counter flag (counters are set by `counter` effects). */
  | { kind: "counter"; flag: string; op?: CompareOp; value: number }
  /** At least one living person matches (relation/rel-meter filters). */
  | {
      kind: "person";
      relation?: Relation[];
      minRel?: number;
      maxRel?: number;
    }
  /** Character has an active ailment (any, or a specific disease id). */
  | { kind: "ailment"; ailment?: string };

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
  | { kind: "die"; cause: string }
  /** Contract a disease/condition defined by a pack. */
  | { kind: "ailment"; ailment: string }
  /** Cure an active ailment (id), or every ailment when omitted. */
  | { kind: "cure"; ailment?: string }
  /** Adjust the relationship meter of the event's subject person. */
  | { kind: "rel"; delta: number }
  /** Change the subject's relation (partner → spouse, → ex…). */
  | { kind: "relation"; relation: Relation }
  /** Introduce a persistent NPC (friend, coworker, child, …). */
  | { kind: "person"; role: Relation; name?: string; rel?: number }
  /** Append a memory to the subject person (and the life log). */
  | { kind: "memory"; text: string };

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
  /** If set, the event is about a specific NPC picked from the roster at
   *  draw time. `{{subject.name}}` (and .age / .relation) tokens in the
   *  title, description, choice text and results are interpolated, and
   *  `rel`/`memory` effects apply to that person. */
  subject?: SubjectSelector;
  /** Editor layout metadata — ignored by the engine. */
  ui?: { x: number; y: number };
}

/**
 * A dependency on another pack. `pack` is the required pack's id; `version`
 * is an optional semver-ish range — `>=1.2`, `^1.2.3`, `~1.2`, `=1.0` or a
 * bare `1.0.0` for an exact match. The engine tolerates missing requirements
 * (dependent content simply stays locked), but loaders and registries report
 * them so players know which packs to enable together.
 */
export interface PackRequirement {
  pack: string;
  version?: string;
}

/** A job held at some point in this life (flags.job_history entries). */
export interface JobRecord {
  id: string;
  title: string;
  field?: string;
}

export interface EventPack {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Other packs this pack needs loaded (id + optional version range). */
  requires?: PackRequirement[];
  events: SimEvent[];
  /** Optional player-initiated actions (casino, life choices…). */
  actions?: GameAction[];
  /** Optional purchasable items for the shop. */
  items?: ShopItem[];
  /** Optional jobs the character can apply for. */
  jobs?: Job[];
  /** Passive yearly world rules. */
  laws?: WorldLaw[];
  /** Disease/condition definitions the events may inflict. */
  ailments?: DiseaseDef[];
  /** Optional name pools for generated NPCs. */
  names?: { first?: string[]; last?: string[] };
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
  /** Career track — free-form label ("service", "labor", "white_collar",
   *  "public", "medical"…) that `job` conditions gate on. */
  field?: string;
  /** Gate on age, education, flags, past choices, items, stats… */
  conditions?: Condition;
  /** Base hire chance 0-100 (default 65), adjusted by `hireModifiers`. */
  hireWeight?: number;
  hireModifiers?: WeightModifier[];
  hint?: string;
}

/* ------------------------------- world laws ------------------------------- */

/** Law effects must neither consume the event RNG nor require an NPC subject. */
export type WorldLawEffect = Extract<Effect, {
  kind: "stat" | "money" | "trait" | "flag" | "unflag" | "counter" |
    "collect" | "loseitem" | "die" | "cure";
}>;

/**
 * A declarative, data-only yearly rule. Unlike an event, a law has no
 * choices: when its cadence and conditions line up it simply applies its
 * effects (and/or stat drift) to the character. Laws are how a pack makes
 * the world feel like it moves on its own — cost-of-living inflation, slow
 * health decay, era transitions, fame cooling off.
 *
 * Randomness inside a law is stream-isolated: `chance` and `drift.jitter`
 * resolve from deterministic seeded noise keyed on (seed, law id, age),
 * never from the simulation RNG. Their state changes can still affect
 * which events are eligible.
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
  /** RNG-free, subject-free effects applied when the law fires. */
  effects?: WorldLawEffect[];
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

/* ----------------------------- nested packs ------------------------------- */

/**
 * A pack may be split into named subsections. Subsections can be toggled on
 * or off per pack and are how the bundled core pack is organized
 * (relationships / schooling / jobs / health / crime / …). A section either
 * inlines its events or, for bundled packs, references a sibling file via
 * `src` that the loader resolves before validation.
 */
export interface PackSection {
  id: string;
  name: string;
  /** Bundled manifests may point at a sibling JSON file instead. */
  src?: string;
  events?: SimEvent[];
  ailments?: DiseaseDef[];
  laws?: WorldLaw[];
}

/** Raw on-disk/imported shape: flat events, nested sections, or both. */
export interface PackFile {
  id: string;
  name: string;
  version: string;
  description?: string;
  events?: SimEvent[];
  ailments?: DiseaseDef[];
  actions?: GameAction[];
  items?: ShopItem[];
  jobs?: Job[];
  /** Passive yearly world rules. */
  laws?: WorldLaw[];
  /** Other packs this pack depends on (id + optional version range). */
  requires?: PackRequirement[];
  names?: { first?: string[]; last?: string[] };
  sections?: PackSection[];
}

/** Section metadata kept alongside a flattened pack for the enable/disable UI. */
export interface PackSectionInfo {
  id: string;
  name: string;
  eventIds: string[];
  ailmentIds: string[];
  lawIds: string[];
}

/** A validated pack plus its section map (flat packs have no sections). */
export interface LoadedPack {
  pack: EventPack;
  sections: PackSectionInfo[];
}

/* --------------------------------- people --------------------------------- */

export type Relation =
  | "mother"
  | "father"
  | "sibling"
  | "grandparent"
  | "friend"
  | "partner"
  | "spouse"
  | "child"
  | "coworker"
  | "ex";

/** A persistent NPC that lives across years: ages, drifts, can die or move away. */
export interface Person {
  id: string;
  name: string;
  age: number;
  relation: Relation;
  /** Relationship meter, -100..100. */
  rel: number;
  alive: boolean;
  /** Why they left the roster, if they did. */
  gone?: "died" | "moved";
  traits: string[];
  /** Player's age when the person entered their life. */
  metAge: number;
  /** Notable things that happened with this person. */
  memories: string[];
  /** action id -> age it was last used (once-per-year actions). */
  lastActAge: Record<string, number>;
}

/** Which person an event talks about; picked from the roster at draw time. */
export interface SubjectSelector {
  relation?: Relation[];
  minRel?: number;
  maxRel?: number;
}

/* -------------------------------- ailments -------------------------------- */

export type AilmentKind = "physical" | "mental" | "injury";
export type AilmentCourse = "acute" | "chronic" | "progressive";

export interface TreatmentDef {
  id: string;
  label: string;
  /** Who performs it — drives the UI label (GP, therapist, surgeon, ER…). */
  provider: "gp" | "therapist" | "specialist" | "surgeon" | "er" | "self";
  cost: number;
  /** 0..1 chance the treatment fully cures the ailment. */
  cureChance: number;
  /** Immediate health restored regardless of cure. */
  relieveHealth?: number;
  /** For chronic ailments: reduces the yearly drain instead of curing. */
  reduceDrain?: number;
}

/** Pack-declared disease/condition. */
export interface DiseaseDef {
  id: string;
  name: string;
  blurb?: string;
  kind: AilmentKind;
  /** acute: recovers after durationYears; chronic: stays, treatable;
   *  progressive: drain worsens each year. */
  course: AilmentCourse;
  severity: number;
  /** [min, max] years an acute ailment lasts. */
  durationYears?: [number, number];
  /** Health delta applied every year while active (negative = drain). */
  healthPerYear?: number;
  /** Happiness delta applied every year while active. */
  happinessPerYear?: number;
  /** Progressive only: healthPerYear worsens by this much each year. */
  escalatePerYear?: number;
  treatable?: boolean;
  treatments?: TreatmentDef[];
  /** Per-year probability of dying while the ailment is active. Keep tiny
   *  and age-gate the def's conditions — no childhood mortality spikes. */
  lethalPerYear?: number;
  /** Per-year probability of randomly contracting it, 0..1. */
  onsetWeight?: number;
  /** Contraction gate (age etc.). */
  conditions?: Condition;
}

/** A disease the character currently has. */
export interface ActiveAilment {
  id: string;
  defId: string;
  name: string;
  kind: AilmentKind;
  course: AilmentCourse;
  severity: number;
  /** Remaining years for acute ailments. */
  yearsLeft?: number;
  /** Current yearly health drain (escalates for progressive). */
  drain: number;
  happy: number;
  treatable: boolean;
  /** Age at which it was contracted. */
  sinceAge: number;
}

/* --------------------------------- runtime --------------------------------- */

export interface PendingEvent {
  event: SimEvent;
  /** Choices after filtering by their conditions. */
  choices: Choice[];
  /** The NPC this event is about, when the event declares a `subject`. */
  subject?: Person;
}

export interface LogEntry {
  age: number;
  text: string;
  kind: "year" | "event" | "result" | "death" | "birth";
}
