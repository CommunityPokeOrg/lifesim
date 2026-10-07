import { describe, expect, it } from "vitest";
import { LifeSim } from "./engine";
import { buyItem, itemStatus, listActions, performAction } from "./actions";
import { validatePack } from "./schema";
import { simulate } from "./simulate";
import actionsPack from "../packs/actions.json";
import cardingPack from "../packs/carding.json";
import { bundledCorePack } from "../packs/index";
import type { EventPack } from "./types";

const core = bundledCorePack();
const actions = actionsPack as EventPack;
const carding = cardingPack as EventPack;
const all: EventPack[] = [core, actions, carding];

function life(seed = 42, packs: EventPack[] = all) {
  return new LifeSim(packs, { seed, name: "Test" });
}

/** Age the sim to a target age, auto-resolving events with the first choice. */
function ageTo(sim: LifeSim, age: number) {
  let guard = 0;
  while (sim.character.alive && sim.character.age < age && guard++ < 500) {
    if (sim.pending) sim.resolve(sim.pending.choices[0].id);
    else sim.ageUp();
  }
  while (sim.pending) sim.resolve(sim.pending.choices[0].id);
}

/** Reach a chained (weight-0) event directly. */
function chainTo(sim: LifeSim, eventId: string) {
  (sim as unknown as { chain: (id: string, d: number) => void }).chain(eventId, 0);
}

/** Give the character the full fictional carding setup: lifestyle + gear. */
function gearUp(sim: LifeSim) {
  const c = sim.character;
  c.flags.carding_lifestyle = true;
  c.money = 10000;
  expect(buyItem(sim, "burner_phone").ok).toBe(true);
  expect(buyItem(sim, "blank_pvc_cards").ok).toBe(true);
  expect(buyItem(sim, "msr_writer").ok).toBe(true);
}

describe("carding pack", () => {
  it("passes pack validation", () => {
    const res = validatePack(cardingPack);
    expect(res.ok, res.ok ? "" : res.errors.join("\n")).toBe(true);
  });

  it("has no id collisions with the core and actions packs", () => {
    const taken = new Set<string>([
      ...core.events.map((e) => e.id),
      ...(core.actions ?? []).map((a) => a.id),
      ...(core.items ?? []).map((i) => i.id),
      ...(core.jobs ?? []).map((j) => j.id),
      ...actions.events.map((e) => e.id),
      ...(actions.actions ?? []).map((a) => a.id),
      ...(actions.items ?? []).map((i) => i.id),
      ...(actions.jobs ?? []).map((j) => j.id),
    ]);
    for (const entry of [
      ...carding.events,
      ...(carding.actions ?? []),
      ...(carding.items ?? []),
      ...(carding.jobs ?? []),
    ]) {
      expect(taken.has(entry.id), `collision on ${entry.id}`).toBe(false);
    }
  });

  it("registers its actions and items on the sim", () => {
    const sim = life();
    for (const id of [
      "act_score_dumps",
      "act_encode_cards",
      "act_run_card",
      "act_fence_parts",
      "act_lay_low",
    ]) {
      expect(sim.actions.has(id), id).toBe(true);
    }
    for (const id of ["burner_phone", "blank_pvc_cards", "msr_writer"]) {
      expect(sim.items.has(id), id).toBe(true);
    }
  });

  it("keeps the pack's events out of a sim where the pack isn't loaded", () => {
    const sim = life(7, [core, actions]);
    expect(sim.events.has("carding.forum_offer")).toBe(false);
    expect(sim.actions.has("act_run_card")).toBe(false);
  });
});

describe("fictional gear (shop items)", () => {
  it("sells the burner phone and PVC stock to teens, the writer to adults", () => {
    const sim = life();
    ageTo(sim, 16);
    sim.character.money = 5000;
    expect(itemStatus(sim, sim.items.get("burner_phone")!).eligible).toBe(true);
    expect(itemStatus(sim, sim.items.get("blank_pvc_cards")!).eligible).toBe(true);
    expect(itemStatus(sim, sim.items.get("msr_writer")!).eligible).toBe(false); // 18+
  });

  it("buying blank PVC cards stocks the pvc_cards counter", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.money = 5000;
    expect(buyItem(sim, "blank_pvc_cards").ok).toBe(true);
    expect(sim.character.flags.pvc_cards).toBe(10);
    expect(sim.character.flags.item_blank_pvc_cards).toBe(true);
  });
});

describe("the carding action pipeline", () => {
  it("gates dump buying on the lifestyle flag and a burner phone", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.money = 5000;
    const status = () => listActions(sim).find((s) => s.action.id === "act_score_dumps")!;
    // No lifestyle, no phone.
    expect(status().eligible).toBe(false);
    // Lifestyle but no phone.
    sim.character.flags.carding_lifestyle = true;
    expect(status().eligible).toBe(false);
    // Phone but no lifestyle.
    delete sim.character.flags.carding_lifestyle;
    buyItem(sim, "burner_phone");
    expect(status().eligible).toBe(false);
    // Both — the pipeline opens.
    sim.character.flags.carding_lifestyle = true;
    expect(status().eligible).toBe(true);
  });

  it("encodes dumps onto blanks into cloned cards", () => {
    const sim = life();
    ageTo(sim, 20);
    gearUp(sim);
    sim.character.flags.dumps = 3;
    const pvc0 = Number(sim.character.flags.pvc_cards);
    for (let i = 0; i < 3; i++) {
      expect(performAction(sim, "act_encode_cards").ok).toBe(true);
    }
    const c = sim.character;
    // Every attempt consumes a blank card.
    expect(Number(c.flags.pvc_cards)).toBeLessThan(pvc0);
    // The counter flow holds: clones + dumps + pvc never go negative in a
    // way that breaks gating (schema/tests treat <1 as empty).
    expect(Number(c.flags.cloned_cards ?? 0)).toBeGreaterThanOrEqual(0);
    expect(Number(c.flags.dumps)).toBeGreaterThanOrEqual(0);
  });

  it("encoding is locked without the writer", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.flags.carding_lifestyle = true;
    sim.character.money = 5000;
    buyItem(sim, "burner_phone");
    buyItem(sim, "blank_pvc_cards");
    sim.character.flags.dumps = 5;
    const status = listActions(sim).find((s) => s.action.id === "act_encode_cards")!;
    expect(status.eligible).toBe(false);
  });

  it("running a card always consumes it or chains into a risk event", () => {
    // Across seeds we should see both a quiet outcome and a chained
    // decline/hold or police encounter.
    let chains = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const sim = life(seed);
      ageTo(sim, 22);
      gearUp(sim);
      sim.character.flags.cloned_cards = 1;
      expect(performAction(sim, "act_run_card").ok).toBe(true);
      if (sim.pending) {
        expect(
          ["carding.terminal_hold", "carding.police_encounter"],
          `unexpected chain ${sim.pending.event.id}`,
        ).toContain(sim.pending.event.id);
        chains++;
        while (sim.pending) sim.resolve(sim.pending.choices[0].id);
      } else {
        expect(sim.character.flags.cloned_cards).toBe(0);
      }
    }
    expect(chains).toBeGreaterThan(0);
  });

  it("laying low bleeds off heat", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.flags.carding_heat = 5;
    expect(performAction(sim, "act_lay_low").ok).toBe(true);
    expect(sim.character.flags.carding_heat).toBe(2);
  });

  it("a hot enough lifestyle forces the dawn raid", () => {
    // Carding pack alone: heat_raid is the only forced event that can be
    // eligible, so it must be the pending event.
    const sim = life(3, [carding]);
    let guard = 0;
    while (sim.character.age < 20 && guard++ < 50) {
      if (sim.pending) sim.resolve(sim.pending.choices[0].id);
      else sim.ageUp();
    }
    sim.character.flags.carding_lifestyle = true;
    sim.character.flags.carding_heat = 8;
    sim.ageUp();
    expect(sim.pending?.event.id).toBe("carding.heat_raid");
  });
});

describe("risk checks", () => {
  it("a police encounter can end in arrest and hand off to booking", () => {
    let sawArrest = false;
    let sawWalkAway = false;
    for (let seed = 1; seed <= 60 && !(sawArrest && sawWalkAway); seed++) {
      const sim = life(seed);
      ageTo(sim, 22);
      sim.character.flags.carding_heat = 10; // high heat tilts toward arrest
      chainTo(sim, "carding.police_encounter");
      expect(sim.pending?.event.id).toBe("carding.police_encounter");
      sim.resolve("cooperate");
      if (sim.character.flags.in_prison) {
        sawArrest = true;
        expect(sim.pending?.event.id).toBe("carding.busted");
        // The plea deal trims the sentence.
        sim.resolve("plea");
        expect(sim.character.flags.sentence).toBe(1);
      } else {
        sawWalkAway = true;
      }
    }
    expect(sawArrest).toBe(true);
    expect(sawWalkAway).toBe(true);
  });

  it("a police search confiscates the gear (items + counters)", () => {
    // Find a seed where cooperate → the confiscation outcome.
    for (let seed = 1; seed <= 60; seed++) {
      const sim = life(seed);
      ageTo(sim, 22);
      gearUp(sim);
      sim.character.flags.dumps = 4;
      sim.character.flags.cloned_cards = 2;
      chainTo(sim, "carding.police_encounter");
      sim.resolve("cooperate");
      if (!sim.character.flags.in_prison && sim.character.flags.dumps === 0) {
        expect(sim.character.flags.item_msr_writer).toBeUndefined();
        expect(sim.character.flags.cloned_cards).toBe(0);
        expect(sim.character.flags.pvc_cards).toBe(0);
        return;
      }
      while (sim.pending) sim.resolve(sim.pending.choices[0].id);
    }
    throw new Error("no seed produced the confiscation outcome");
  });

  it("the raid's shred outcome can beat the wrap at the cost of the gear", () => {
    let sawEscape = false;
    for (let seed = 1; seed <= 60 && !sawEscape; seed++) {
      const sim = life(seed);
      ageTo(sim, 22);
      gearUp(sim);
      sim.character.flags.dumps = 3;
      sim.character.flags.carding_heat = 8;
      chainTo(sim, "carding.heat_raid");
      expect(sim.pending?.event.id).toBe("carding.heat_raid");
      sim.resolve("shred");
      if (!sim.character.flags.in_prison) {
        sawEscape = true;
        expect(sim.character.flags.dumps).toBe(0);
        expect(sim.character.flags.cloned_cards).toBe(0);
        expect(sim.character.flags.item_msr_writer).toBeUndefined();
        expect(Number(sim.character.flags.carding_heat)).toBeLessThan(8);
      }
    }
    expect(sawEscape).toBe(true);
  });
});

describe("batch sanity", () => {
  const report = simulate({ lives: 800, packs: all, seedBase: 101 });

  it("ungated and lifestyle-gated events all fire", () => {
    for (const id of [
      "carding.forum_offer",
      "carding.terminal_find",
      "carding.fraud_alert",
      "carding.mule_offer",
    ]) {
      expect(report.events.get(id)?.fires, `"${id}" never fired`).toBeGreaterThan(0);
    }
  });

  it("chain targets resolve in batch play (police, booking, raid)", () => {
    for (const id of [
      "carding.police_encounter",
      "carding.busted",
      "carding.heat_raid",
    ]) {
      expect(report.events.get(id)?.fires, `"${id}" never reached`).toBeGreaterThan(0);
    }
  });

  it("doesn't drag down mean lifespan", () => {
    expect(report.meanAge).toBeGreaterThan(55);
  });
});
