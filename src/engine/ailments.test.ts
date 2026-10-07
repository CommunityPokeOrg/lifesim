import { describe, expect, it } from "vitest";
import { LifeSim } from "./engine";
import type { DiseaseDef, EventPack } from "./types";

const flu: DiseaseDef = {
  id: "flu",
  name: "Influenza",
  kind: "physical",
  course: "acute",
  severity: 1,
  durationYears: [1, 2],
  healthPerYear: -3,
  happinessPerYear: -2,
  treatable: true,
  treatments: [
    { id: "rest", label: "Rest", provider: "self", cost: 0, cureChance: 1, relieveHealth: 5 },
  ],
  onsetWeight: 0,
};

const arthritis: DiseaseDef = {
  id: "arthritis",
  name: "Arthritis",
  kind: "physical",
  course: "chronic",
  severity: 2,
  healthPerYear: -2,
  treatable: true,
  treatments: [
    { id: "pt", label: "Physio", provider: "specialist", cost: 800, cureChance: 0, reduceDrain: 2 },
  ],
};

const doom: DiseaseDef = {
  id: "doom",
  name: "Test Plague",
  kind: "physical",
  course: "progressive",
  severity: 3,
  healthPerYear: -1,
  escalatePerYear: 2,
  lethalPerYear: 1, // certain death roll each year — test-only
  treatable: false,
  conditions: { kind: "age", min: 50 }, // age-gated like real lethal defs
  onsetWeight: 0.5,
};

const pack: EventPack = {
  id: "t",
  name: "t",
  version: "1",
  events: [
    { id: "filler", title: "t", description: "t", weight: 1, conditions: { kind: "age", min: 200 }, choices: [{ id: "x", text: "x", result: "r" }] },
  ],
  ailments: [flu, arthritis, doom],
};

function sim(seed = 1, packs: EventPack[] = [pack]) {
  return new LifeSim(packs, { seed, name: "T" });
}

function ageYears(s: LifeSim, n: number) {
  for (let i = 0; i < n && s.character.alive; i++) {
    s.ageUp();
    while (s.pending) s.resolve(s.pending.choices[0].id);
  }
}

describe("ailments", () => {
  it("ailment effect contracts a pack-defined disease", () => {
    const s = sim(2);
    s.applyEffects([{ kind: "ailment", ailment: "flu" }]);
    const a = s.character.ailments[0];
    expect(a?.defId).toBe("flu");
    expect(a?.course).toBe("acute");
    expect(a?.yearsLeft).toBeGreaterThanOrEqual(1);
  });

  it("acute ailments drain health then expire on their own", () => {
    const s = sim(4);
    const start = s.character.stats.health;
    s.applyEffects([{ kind: "ailment", ailment: "flu" }]);
    ageYears(s, 3);
    expect(s.character.ailments.some((a) => a.defId === "flu")).toBe(false);
    expect(s.character.stats.health).toBeLessThan(start);
    expect(s.log.some((l) => l.text.includes("recovered from Influenza"))).toBe(true);
  });

  it("treatment cures when the roll lands and charges the cost", () => {
    const s = sim(6);
    s.character.money = 1000;
    s.applyEffects([{ kind: "ailment", ailment: "flu" }]);
    const a = s.character.ailments[0];
    const offers = s.treatments(a.id);
    expect(offers[0].treatment.id).toBe("rest");
    const text = s.treat(a.id, "rest"); // cureChance 1 — always works
    expect(text).toContain("no more Influenza");
    expect(s.character.ailments).toHaveLength(0);
  });

  it("chronic treatments reduce the yearly drain instead of curing", () => {
    const s = sim(8);
    s.character.money = 5000;
    s.applyEffects([{ kind: "ailment", ailment: "arthritis" }]);
    const a = s.character.ailments[0];
    expect(a.drain).toBe(-2);
    const text = s.treat(a.id, "pt");
    expect(s.character.money).toBe(4200);
    expect(s.character.ailments).toHaveLength(0); // reduceDrain brought drain to 0 → controlled
    expect(text).toContain("under control");
  });

  it("unaffordable treatments are refused without charging", () => {
    const s = sim(10);
    s.character.money = 0;
    s.applyEffects([{ kind: "ailment", ailment: "arthritis" }]);
    const a = s.character.ailments[0];
    const text = s.treat(a.id, "pt");
    expect(text).toContain("can't afford");
    expect(s.character.money).toBe(0);
  });

  it("ailment condition gates events on having a disease", () => {
    const gated: EventPack = {
      id: "g",
      name: "g",
      version: "1",
      events: [
        {
          id: "sick_day",
          title: "t",
          description: "t",
          weight: 1000,
          conditions: { kind: "all", conditions: [{ kind: "ailment", ailment: "arthritis" }, { kind: "age", min: 1, max: 1 }] },
          choices: [{ id: "x", text: "x", result: "r" }],
        },
      ],
    };
    const s = sim(12, [gated, pack]);
    s.applyEffects([{ kind: "ailment", ailment: "arthritis" }]);
    let guard = 0;
    while (!s.pending && guard++ < 5) s.ageUp();
    expect(s.pending?.event.id).toBe("sick_day");
  });

  it("cure effect removes ailments", () => {
    const s = sim(14);
    s.applyEffects([{ kind: "ailment", ailment: "flu" }]);
    s.applyEffects([{ kind: "cure", ailment: s.character.ailments[0].id }]);
    expect(s.character.ailments).toHaveLength(0);
  });

  it("lethal ailments kill only inside their age gate — no early deaths", () => {
    // Run many lives; nobody should die of the plague before age 50.
    let minPlagueAge = 200;
    for (let i = 0; i < 40; i++) {
      const s = sim(100 + i);
      // Track the first year the plague could possibly strike.
      while (s.character.alive && s.character.age < 60) {
        s.ageUp();
        while (s.pending) s.resolve(s.pending.choices[0].id);
      }
      if (s.character.deathCause === "test plague") {
        minPlagueAge = Math.min(minPlagueAge, s.character.age);
      }
    }
    expect(minPlagueAge).toBeGreaterThanOrEqual(50);
  });

  it("progressive ailments escalate their drain", () => {
    const s = sim(16);
    s.applyEffects([{ kind: "ailment", ailment: "doom" }]);
    const a = s.character.ailments[0];
    a.drain = -1;
    // ageUp triggers lethality (1.0) so test the escalation via a non-lethal def clone
    const slow: DiseaseDef = { ...doom, id: "slow", lethalPerYear: 0, onsetWeight: 0 };
    const s2 = sim(18, [{ ...pack, ailments: [slow] }]);
    s2.applyEffects([{ kind: "ailment", ailment: "slow" }]);
    const a2 = s2.character.ailments[0];
    expect(a2.drain).toBe(-1);
    s2.ageUp();
    while (s2.pending) s2.resolve(s2.pending.choices[0].id);
    expect(s2.character.ailments[0]?.drain).toBe(-3);
    void a;
  });
});
