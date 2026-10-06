import { describe, expect, it } from "vitest";
import { LifeSim } from "./engine";
import type { EventPack, SimEvent } from "./types";

const emptyPack: EventPack = { id: "t", name: "t", version: "1", events: [
  { id: "filler", title: "t", description: "t", weight: 1, conditions: { kind: "age", min: 200 }, choices: [{ id: "x", text: "x", result: "r" }] },
] };

function sim(seed = 1, packs: EventPack[] = [emptyPack]) {
  return new LifeSim(packs, { seed, name: "Test" });
}

function ageYears(s: LifeSim, n: number) {
  for (let i = 0; i < n && s.character.alive; i++) {
    s.ageUp();
    while (s.pending) s.resolve(s.pending.choices[0].id);
  }
}

describe("people", () => {
  it("generates a family at birth with a mother and plausible ages", () => {
    const c = sim(3).character;
    const mom = c.people.find((p) => p.relation === "mother");
    expect(mom).toBeTruthy();
    expect(mom!.age).toBeGreaterThanOrEqual(24);
    expect(mom!.age).toBeLessThanOrEqual(41);
    expect(c.people.every((p) => p.alive && p.rel >= -100 && p.rel <= 100)).toBe(true);
  });

  it("is deterministic per seed", () => {
    const a = sim(9).character.people.map((p) => [p.name, p.age, p.relation]);
    const b = sim(9).character.people.map((p) => [p.name, p.age, p.relation]);
    expect(a).toEqual(b);
  });

  it("ages people with the character and keeps them across years", () => {
    const s = sim(5);
    const mom = s.character.people.find((p) => p.relation === "mother")!;
    const startAge = mom.age;
    ageYears(s, 10);
    expect(s.character.people.find((p) => p.id === mom.id)!.age).toBe(startAge + 10);
  });

  it("people actions adjust the relationship meter and log results", () => {
    const s = sim(7);
    const mom = s.character.people.find((p) => p.relation === "mother")!;
    const before = mom.rel;
    const text = s.interact(mom.id, "spend_time");
    expect(text).toContain(mom.name);
    expect(mom.rel).toBeGreaterThan(before);
    expect(s.log[s.log.length - 1].text).toBe(text);
  });

  it("limits yearly actions to once per person per year", () => {
    const s = sim(8);
    const mom = s.character.people.find((p) => p.relation === "mother")!;
    expect(s.peopleActions(mom.id).some((a) => a.id === "ask_money")).toBe(true);
    s.interact(mom.id, "ask_money");
    expect(s.peopleActions(mom.id).some((a) => a.id === "ask_money")).toBe(false);
  });

  it("ask_for_money gives a bounded gift and costs a little rel", () => {
    const s = sim(11);
    const mom = s.character.people.find((p) => p.relation === "mother")!;
    const rel = mom.rel;
    s.interact(mom.id, "ask_money");
    expect(s.character.money).toBeGreaterThan(0);
    expect(s.character.money).toBeLessThan(300);
    expect(mom.rel).toBeLessThan(rel);
  });

  it("ask_out turns a friend into a partner and sets the flag", () => {
    const s = sim(13);
    ageYears(s, 14);
    // Seed a friendly friend and force the success path via many seeds of rng use.
    const friend = s.character.people.find((p) => p.relation === "friend") ??
      (() => {
        s.applyEffects([{ kind: "person", role: "friend", name: "Sam", rel: 90 }]);
        return s.character.people.find((p) => p.relation === "friend")!;
      })();
    friend.rel = 90;
    friend.age = s.character.age; // age-appropriate
    let tries = 0;
    while (!s.character.flags.partner && tries++ < 40) {
      friend.lastActAge = {}; // reset yearly limit for the loop
      s.interact(friend.id, "ask_out");
    }
    expect(s.character.flags.partner).toBe(true);
    expect(friend.relation).toBe("partner");
    // break_up reverts it
    s.interact(friend.id, "break_up");
    expect(s.character.flags.partner).toBeUndefined();
    expect(friend.relation).toBe("ex");
  });

  it("propose upgrades a partner to spouse", () => {
    const s = sim(17);
    ageYears(s, 19);
    s.applyEffects([{ kind: "person", role: "partner", name: "Jo", rel: 90 }]);
    const partner = s.character.people.find((p) => p.relation === "partner")!;
    let tries = 0;
    while (!s.character.flags.married && tries++ < 40) {
      partner.lastActAge = {};
      s.interact(partner.id, "propose");
    }
    expect(s.character.flags.married).toBe(true);
    expect(partner.relation).toBe("spouse");
  });

  it("subject events interpolate the NPC's name into text", () => {
    const ev: SimEvent = {
      id: "mom_call",
      title: "A call",
      description: "Your mother, {{subject.name}}, wants to chat.",
      weight: 1000,
      conditions: { kind: "age", min: 1, max: 1 },
      subject: { relation: ["mother"] },
      choices: [
        { id: "chat", text: "Chat with {{subject.name}}", result: "Nice talk with {{subject.name}}.", effects: [{ kind: "rel", delta: 10 }] },
      ],
    };
    const s = sim(21, [{ ...emptyPack, events: [ev] }]);
    const mom = s.character.people.find((p) => p.relation === "mother")!;
    const relBefore = mom.rel;
    let guard = 0;
    while (!s.pending && guard++ < 5) s.ageUp();
    expect(s.pending?.event.id).toBe("mom_call");
    expect(s.pending!.event.description).toContain(mom.name);
    expect(s.pending!.subject?.id).toBe(mom.id);
    s.resolve("chat");
    expect(mom.rel).toBe(relBefore + 10);
    expect(s.log[s.log.length - 1].text).toContain(mom.name);
  });

  it("person-gated events stay ineligible without a matching NPC", () => {
    const ev: SimEvent = {
      id: "spouse_fight",
      title: "Fight",
      description: "d",
      weight: 1000,
      conditions: { kind: "person", relation: ["spouse"] },
      choices: [{ id: "x", text: "x", result: "r" }],
    };
    const s = sim(23, [{ ...emptyPack, events: [ev] }]);
    ageYears(s, 25);
    expect(s.character.history["spouse_fight"]).toBeUndefined();
  });

  it("elders can die of old age and grief is logged", () => {
    const s = sim(29);
    const mom = s.character.people.find((p) => p.relation === "mother")!;
    mom.age = 96; // push her into the mortality band
    let sawDeath = false;
    for (let i = 0; i < 40 && !sawDeath; i++) {
      s.ageUp();
      while (s.pending) s.resolve(s.pending.choices[0].id);
      sawDeath = !mom.alive;
    }
    expect(mom.alive).toBe(false);
    expect(s.log.some((l) => l.text.includes(mom.name) && l.text.includes("died"))).toBe(true);
  });
});
