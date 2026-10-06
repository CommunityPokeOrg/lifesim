import { evalCondition, effectiveWeight } from "./conditions";
import { makeRng, weightedPick, type Rng } from "./rng";
import type {
  Character,
  Choice,
  Effect,
  EventPack,
  LogEntry,
  Outcome,
  PendingEvent,
  SimEvent,
  StatKey,
} from "./types";

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** Traits a new character can be born with (starter pool, not pack data). */
export const BIRTH_TRAITS = [
  "athletic",
  "bookish",
  "charming",
  "sickly",
  "lucky",
  "hot-headed",
  "shy",
] as const;

const MAX_GOTO_DEPTH = 5;

export interface SimOptions {
  seed?: number;
  name?: string;
}

/**
 * The engine holds one character's life plus the merged event pool from all
 * loaded packs. It is UI-agnostic: `ageUp()` queues an event, `resolve()`
 * applies the player's choice. Everything is deterministic for a given seed.
 */
export class LifeSim {
  readonly rng: Rng;
  readonly events = new Map<string, SimEvent>();
  character: Character;
  log: LogEntry[] = [];
  pending: PendingEvent | null = null;

  constructor(packs: EventPack[], opts: SimOptions = {}) {
    this.rng = makeRng(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
    for (const pack of packs) this.loadPack(pack);
    this.character = this.birth(opts.name ?? "Alex");
  }

  /** Merge a pack's events into the pool. Ids must be unique across packs. */
  loadPack(pack: EventPack) {
    for (const ev of pack.events) this.events.set(ev.id, ev);
  }

  private birth(name: string): Character {
    const r = this.rng;
    const stats = {
      health: 60 + Math.floor(r() * 40),
      happiness: 50 + Math.floor(r() * 30),
      smarts: 30 + Math.floor(r() * 40),
      looks: 30 + Math.floor(r() * 40),
    };
    const traits: string[] = [];
    if (r() < 0.6) traits.push(BIRTH_TRAITS[Math.floor(r() * BIRTH_TRAITS.length)]);
    this.log.push({ age: 0, text: `${name} was born.`, kind: "birth" });
    return {
      name,
      age: 0,
      stats,
      money: 0,
      traits,
      flags: {},
      history: {},
      firedOnce: [],
      alive: true,
    };
  }

  /* -------------------------------- yearly tick -------------------------------- */

  private passiveTick() {
    const c = this.character;
    const notes: string[] = [];

    if (c.flags.in_school) c.stats.smarts = clamp(c.stats.smarts + 1);
    if (c.flags.employed) {
      const salary = Number(c.flags.salary ?? 0);
      c.money += salary;
      if (salary) notes.push(`Earned $${salary.toLocaleString()} at work.`);
    }
    if (c.flags.in_prison) {
      c.stats.health = clamp(c.stats.health - 2);
      c.stats.happiness = clamp(c.stats.happiness - 3);
      const left = Number(c.flags.sentence ?? 1) - 1;
      if (left <= 0) {
        delete c.flags.in_prison;
        delete c.flags.sentence;
        notes.push("Released from prison.");
      } else {
        c.flags.sentence = left;
        notes.push(`${left} year${left === 1 ? "" : "s"} left on the sentence.`);
      }
    }
    if (c.flags.partner) c.stats.happiness = clamp(c.stats.happiness + 1);

    // Age-related health drift.
    if (c.age > 85) c.stats.health = clamp(c.stats.health - 6);
    else if (c.age > 70) c.stats.health = clamp(c.stats.health - 4);
    else if (c.age > 55) c.stats.health = clamp(c.stats.health - 2);

    if (c.traits.includes("sickly")) c.stats.health = clamp(c.stats.health - 1);

    return notes;
  }

  private checkDeath(): boolean {
    const c = this.character;
    if (c.stats.health <= 0) {
      this.die("failing health");
      return true;
    }
    // Old-age mortality ramps up past 80.
    if (c.age > 80) {
      const p = Math.min(0.5, (c.age - 80) * 0.03 + (c.traits.includes("sickly") ? 0.05 : 0));
      if (this.rng() < p) {
        this.die("old age");
        return true;
      }
    }
    return false;
  }

  private die(cause: string) {
    const c = this.character;
    c.alive = false;
    c.deathCause = cause;
    this.log.push({ age: c.age, text: `${c.name} died of ${cause} at age ${c.age}.`, kind: "death" });
    this.pending = null;
  }

  /** Advance one year. Returns the queued event, if any. */
  ageUp(): PendingEvent | null {
    const c = this.character;
    if (!c.alive) return null;
    if (this.pending) return this.pending; // must resolve the pending event first

    c.age += 1;
    this.log.push({ age: c.age, text: `Age ${c.age}`, kind: "year" });
    for (const note of this.passiveTick()) {
      this.log.push({ age: c.age, text: note, kind: "year" });
    }
    if (this.checkDeath()) return null;

    const eligible: SimEvent[] = [];
    const weights: number[] = [];
    for (const ev of this.events.values()) {
      if (ev.once && c.firedOnce.includes(ev.id)) continue;
      if (!evalCondition(ev.conditions, c)) continue;
      const choices = ev.choices.filter((ch) => evalCondition(ch.conditions, c));
      if (!choices.length) continue;
      eligible.push(ev);
      weights.push(effectiveWeight(ev.weight ?? 10, ev.weightModifiers, c));
    }

    // Quiet-year baseline: ~20% of the total draw weight, so most years
    // something happens but calm years exist.
    const total = weights.reduce((s, w) => s + w, 0);
    const quiet = Math.max(5, total * 0.2);
    const pick = weightedPick(this.rng, [...weights, quiet]);
    if (pick === weights.length || pick === -1) return null;

    const ev = eligible[pick];
    this.pending = {
      event: ev,
      choices: ev.choices.filter((ch) => evalCondition(ch.conditions, c)),
    };
    this.log.push({ age: c.age, text: `${ev.title} — ${ev.description}`, kind: "event" });
    return this.pending;
  }

  /** Resolve the pending event with the player's choice. */
  resolve(choiceId: string) {
    const pending = this.pending;
    if (!pending) throw new Error("no pending event");
    const choice = pending.choices.find((ch) => ch.id === choiceId);
    if (!choice) throw new Error(`choice "${choiceId}" not available`);

    const c = this.character;
    c.history[pending.event.id] = choice.id;
    if (pending.event.once && !c.firedOnce.includes(pending.event.id)) {
      c.firedOnce.push(pending.event.id);
    }
    this.pending = null;
    this.resolveChoice(choice, 0);
  }

  private resolveChoice(choice: Choice, depth: number) {
    const c = this.character;
    const outcome = this.pickOutcome(choice);
    if (outcome?.effects) this.applyEffects(outcome.effects);
    const text = outcome?.result;
    if (text) this.log.push({ age: c.age, text, kind: "result" });
    if (!c.alive) return;
    // An outcome-level goto wins; a choice-level goto is the default for all
    // outcomes (this is also what the graph editor's edges write).
    const goto = outcome?.goto ?? choice.goto;
    if (goto && depth < MAX_GOTO_DEPTH) this.chain(goto, depth + 1);
  }

  private pickOutcome(choice: Choice): Outcome | null {
    if (choice.outcomes?.length) {
      const weights = choice.outcomes.map((o) =>
        effectiveWeight(o.weight, o.weightModifiers, this.character),
      );
      const i = weightedPick(this.rng, weights);
      return choice.outcomes[Math.max(0, i)];
    }
    // Shorthand fixed outcome.
    return { weight: 1, effects: choice.effects, result: choice.result ?? "", goto: choice.goto };
  }

  private chain(eventId: string, _depth: number) {
    const ev = this.events.get(eventId);
    if (!ev) {
      this.log.push({ age: this.character.age, text: `(missing event "${eventId}")`, kind: "result" });
      return;
    }
    const choices = ev.choices.filter((ch) => evalCondition(ch.conditions, this.character));
    if (!choices.length) return;
    this.pending = { event: ev, choices };
    this.log.push({ age: this.character.age, text: `${ev.title} — ${ev.description}`, kind: "event" });
  }

  applyEffects(effects: Effect[]) {
    const c = this.character;
    for (const e of effects) {
      switch (e.kind) {
        case "stat":
          c.stats[e.stat as StatKey] = clamp(c.stats[e.stat] + e.delta);
          break;
        case "money":
          c.money += e.delta;
          break;
        case "trait":
          if (e.action === "add" && !c.traits.includes(e.trait)) c.traits.push(e.trait);
          if (e.action === "remove") c.traits = c.traits.filter((t) => t !== e.trait);
          break;
        case "flag":
          c.flags[e.flag] = e.value;
          break;
        case "unflag":
          delete c.flags[e.flag];
          break;
        case "die":
          this.die(e.cause);
          break;
      }
    }
  }
}
