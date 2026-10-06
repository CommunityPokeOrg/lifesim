import { describe, expect, it } from "vitest";
import { LifeSim } from "./engine";
import { validatePack } from "./schema";
import { bundledCorePack } from "../packs/index";
import type { EventPack } from "./types";

const pack = bundledCorePack();

function life(seed = 42, packs: EventPack[] = [pack]) {
  return new LifeSim(packs, { seed, name: "Test" });
}

/** Play a life to completion by always picking the first choice. */
function playOut(sim: LifeSim, maxYears = 200) {
  let years = 0;
  while (sim.character.alive && years < maxYears) {
    if (sim.pending) {
      sim.resolve(sim.pending.choices[0].id);
    } else {
      sim.ageUp();
      if (!sim.pending) years++;
    }
  }
  return sim.character;
}

describe("LifeSim", () => {
  it("runs a full life deterministically from a seed", () => {
    const a = playOut(life(7));
    const b = playOut(life(7));
    expect(a.alive).toBe(false);
    expect(a.age).toBe(b.age);
    expect(a.money).toBe(b.money);
    expect(a.stats).toEqual(b.stats);
  });

  it("produces different lives for different seeds", () => {
    const a = playOut(life(1));
    const b = playOut(life(999));
    // Astronomically unlikely to be identical in both age and money.
    expect(a.age !== b.age || a.money !== b.money).toBe(true);
  });

  it("queues an eligible event and resolves the player's choice", () => {
    const sim = life(42);
    // Force the age-5/6 start_school event to be pending.
    let guard = 0;
    while (!sim.pending && guard++ < 10) sim.ageUp();
    expect(sim.pending).not.toBeNull();
    const evId = sim.pending!.event.id;
    const choiceId = sim.pending!.choices[0].id;
    sim.resolve(choiceId);
    expect(sim.character.history[evId]).toBe(choiceId);
  });

  it("respects once:true — a once event never fires twice", () => {
    const sim = life(5);
    const c = playOut(sim);
    void c;
    const fired = sim.character.firedOnce;
    expect(new Set(fired).size).toBe(fired.length);
  });

  it("blocks an event whose conditions can't pass", () => {
    const gated: EventPack = {
      id: "t",
      name: "t",
      version: "1",
      events: [
        {
          id: "never",
          title: "Never",
          description: "n",
          weight: 1000,
          conditions: { kind: "age", min: 200 },
          choices: [{ id: "x", text: "x", result: "r" }],
        },
      ],
    };
    const sim = new LifeSim([gated], { seed: 3 });
    playOut(sim, 130);
    expect(sim.character.history["never"]).toBeUndefined();
  });

  it("stat-driven weight modifiers change outcome probabilities", () => {
    // Outcome A only wins when smarts is high; verify the modifier applies.
    const p: EventPack = {
      id: "t",
      name: "t",
      version: "1",
      events: [
        {
          id: "test",
          title: "t",
          description: "t",
          weight: 1000,
          conditions: { kind: "age", min: 1, max: 1 },
          choices: [
            {
              id: "go",
              text: "go",
              outcomes: [
                {
                  weight: 1,
                  weightModifiers: [
                    { when: { kind: "stat", stat: "smarts", op: "gte", value: 99 }, add: 10000 },
                  ],
                  effects: [{ kind: "flag", flag: "smart_branch", value: true }],
                  result: "smart",
                },
                { weight: 1, effects: [{ kind: "flag", flag: "other", value: true }], result: "other" },
              ],
            },
          ],
        },
      ],
    };
    const sim = new LifeSim([p], { seed: 11 });
    sim.character.stats.smarts = 100; // force the modifier branch to dominate
    let guard = 0;
    while (!sim.pending && guard++ < 10) sim.ageUp();
    sim.resolve("go");
    expect(sim.character.flags.smart_branch).toBe(true);
    expect(sim.character.flags.other).toBeUndefined();
  });

  it("follows goto chains to chained events", () => {
    const p: EventPack = {
      id: "t",
      name: "t",
      version: "1",
      events: [
        {
          id: "a",
          title: "a",
          description: "a",
          weight: 1000,
          conditions: { kind: "age", min: 1, max: 1 },
          choices: [{ id: "go", text: "go", result: "r", goto: "b" }],
        },
        {
          id: "b",
          title: "b",
          description: "b",
          weight: 0,
          choices: [{ id: "ok", text: "ok", result: "done", effects: [{ kind: "flag", flag: "chained", value: true }] }],
        },
      ],
    };
    const sim = new LifeSim([p], { seed: 4 });
    let guard = 0;
    while (!sim.pending && guard++ < 10) sim.ageUp();
    sim.resolve("go");
    expect(sim.pending?.event.id).toBe("b");
    sim.resolve("ok");
    expect(sim.character.flags.chained).toBe(true);
  });

  it("kills the character on a die effect and stops simulating", () => {
    const p: EventPack = {
      id: "t",
      name: "t",
      version: "1",
      events: [
        {
          id: "death",
          title: "d",
          description: "d",
          weight: 1000,
          conditions: { kind: "age", min: 1, max: 1 },
          choices: [
            { id: "x", text: "x", effects: [{ kind: "die", cause: "test death" }], result: "rip" },
          ],
        },
      ],
    };
    const sim = new LifeSim([p], { seed: 1 });
    let guard = 0;
    while (!sim.pending && guard++ < 10) sim.ageUp();
    sim.resolve("x");
    expect(sim.character.alive).toBe(false);
    expect(sim.character.deathCause).toBe("test death");
  });

  it("requires resolving the pending event before aging again", () => {
    const sim = life(2);
    let guard = 0;
    while (!sim.pending && guard++ < 10) sim.ageUp();
    const age = sim.character.age;
    sim.ageUp();
    expect(sim.character.age).toBe(age); // unchanged while pending
  });
});

describe("validatePack", () => {
  it("accepts the bundled core pack", () => {
    const res = validatePack(pack);
    expect(res.ok, res.ok ? "" : res.errors.join("\n")).toBe(true);
  });

  it("rejects non-packs", () => {
    expect(validatePack(null).ok).toBe(false);
    expect(validatePack({ id: "x" }).ok).toBe(false);
    expect(validatePack({ id: "x", name: "x", version: "1", events: [] }).ok).toBe(false);
  });

  it("rejects duplicate event ids and dangling gotos", () => {
    const bad = {
      id: "t",
      name: "t",
      version: "1",
      events: [
        { id: "a", title: "a", description: "a", choices: [{ id: "x", text: "x", result: "r", goto: "missing" }] },
        { id: "a", title: "a2", description: "a2", choices: [{ id: "x", text: "x", result: "r" }] },
      ],
    };
    const res = validatePack(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes("duplicate"))).toBe(true);
      expect(res.errors.some((e) => e.includes("missing"))).toBe(true);
    }
  });

  it("rejects a choice with no result/outcomes", () => {
    const bad = {
      id: "t", name: "t", version: "1",
      events: [{ id: "a", title: "a", description: "a", choices: [{ id: "x", text: "x" }] }],
    };
    const res = validatePack(bad);
    expect(res.ok).toBe(false);
  });
});
