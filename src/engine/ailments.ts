import type { ActiveAilment, Character, DiseaseDef, TreatmentDef } from "./types";
import { evalCondition } from "./conditions";
import type { Rng } from "./rng";

/**
 * Diseases/ailments: contraction, yearly progression and treatment.
 * Definitions live in packs (DiseaseDef); the character carries
 * ActiveAilments produced from them. Deterministic given the sim rng.
 *
 * Balance contract: `lethalPerYear` is the only way an ailment kills
 * outright, and every lethal def in the bundled content is age-gated, so
 * diseases never produce early-life death spikes. Drains just push the
 * health stat down like any other stat effect.
 */

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function contractAilment(c: Character, def: DiseaseDef, rng: Rng): ActiveAilment {
  const [dmin, dmax] = def.durationYears ?? [0, 0];
  const a: ActiveAilment = {
    id: `${def.id}_${Math.floor(rng() * 1e9).toString(36)}`,
    defId: def.id,
    name: def.name,
    kind: def.kind,
    course: def.course,
    severity: def.severity,
    yearsLeft:
      def.course === "acute"
        ? Math.max(1, dmin + Math.floor(rng() * Math.max(1, dmax - dmin + 1)))
        : undefined,
    drain: def.healthPerYear ?? 0,
    happy: def.happinessPerYear ?? 0,
    treatable: def.treatable !== false,
    sinceAge: c.age,
  };
  c.ailments.push(a);
  return a;
}

// `ailmentId` may be an active-ailment instance id or a def id — pack
// effects can't know instance ids, so both match.
export function cureAilment(c: Character, ailmentId?: string): ActiveAilment[] {
  const before = c.ailments;
  const match = (a: ActiveAilment) => a.id === ailmentId || a.defId === ailmentId;
  const removed = ailmentId ? before.filter(match) : before;
  c.ailments = ailmentId ? before.filter((a) => !match(a)) : [];
  return removed;
}

/**
 * Yearly ailment tick: drains, progression, acute expiry, lethality rolls,
 * and random contraction of pack-defined diseases. Returns
 * { notes, died } — died is the death cause when a lethal roll lands.
 */
export function ailmentTick(
  c: Character,
  defs: Map<string, DiseaseDef>,
  rng: Rng,
): { notes: string[]; died?: string } {
  const notes: string[] = [];
  // The combined yearly health drain of every active ailment is capped, so
  // stacking conditions hurts but can't snowball into early-life death
  // spirals; each ailment still drains happiness on its own.
  const totalDrain = Math.max(
    -3,
    c.ailments.reduce((s, a) => s + a.drain, 0),
  );
  c.stats.health = clamp(c.stats.health + totalDrain);
  for (const a of [...c.ailments]) {
    c.stats.happiness = clamp(c.stats.happiness + a.happy);
    const def = defs.get(a.defId);
    if (a.course === "progressive" && def?.escalatePerYear) {
      a.drain -= Math.abs(def.escalatePerYear);
    }
    if (a.course === "acute" && a.yearsLeft !== undefined) {
      a.yearsLeft -= 1;
      if (a.yearsLeft <= 0) {
        c.ailments = c.ailments.filter((x) => x.id !== a.id);
        notes.push(`You recovered from ${a.name}.`);
        continue;
      }
    }
    if (def?.lethalPerYear && rng() < def.lethalPerYear) {
      return { notes, died: a.name.toLowerCase() };
    }
  }
  if (!c.alive) return { notes };

  // Random contraction of pack-defined diseases.
  for (const def of defs.values()) {
    if (!def.onsetWeight || def.onsetWeight <= 0) continue;
    if (!evalCondition(def.conditions, c)) continue;
    if (c.ailments.some((a) => a.defId === def.id)) continue;
    if (rng() < def.onsetWeight) {
      const a = contractAilment(c, def, rng);
      notes.push(`You were diagnosed with ${def.name}.`);
      void a;
    }
  }
  return { notes };
}

export interface TreatmentOffer {
  ailment: ActiveAilment;
  treatment: TreatmentDef;
  affordable: boolean;
}

/** Treatments available for an ailment right now (def-defined or generic rest). */
export function treatmentsFor(
  c: Character,
  def: DiseaseDef | undefined,
  ailment: ActiveAilment,
): TreatmentOffer[] {
  const defs = def?.treatments ?? [];
  const list: TreatmentDef[] =
    defs.length || !ailment.treatable
      ? defs
      : [
          {
            id: "rest",
            label: "Rest and fluids",
            provider: "self",
            cost: 0,
            cureChance: ailment.course === "acute" ? 0.4 : 0.05,
            relieveHealth: 3,
          },
        ];
  return list.map((t) => ({ ailment, treatment: t, affordable: t.cost <= c.money }));
}

/** Apply a treatment: pay, roll the cure, relieve. Returns a log line. */
export function treatAilment(
  c: Character,
  ailmentId: string,
  treatmentId: string,
  defs: Map<string, DiseaseDef>,
  rng: Rng,
): string {
  const a = c.ailments.find((x) => x.id === ailmentId);
  if (!a) return "Nothing to treat.";
  const def = defs.get(a.defId);
  const offers = treatmentsFor(c, def, a);
  const offer = offers.find((o) => o.treatment.id === treatmentId);
  if (!offer) return "That treatment isn't available.";
  const t = offer.treatment;
  if (t.cost > c.money) return `You can't afford ${t.label} ($${t.cost.toLocaleString()}).`;
  c.money -= t.cost;
  if (t.relieveHealth) c.stats.health = clamp(c.stats.health + t.relieveHealth);
  if (t.reduceDrain) a.drain = Math.min(0, a.drain + t.reduceDrain);
  if (rng() < t.cureChance) {
    cureAilment(c, a.id);
    return `${t.label} worked — no more ${a.name}.`;
  }
  if (t.reduceDrain && a.drain === 0) {
    cureAilment(c, a.id);
    return `${t.label} brought ${a.name} fully under control.`;
  }
  return `${t.label} didn't fix the ${a.name.toLowerCase()}, but you're managing.`;
}
