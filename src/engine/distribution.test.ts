import { describe, expect, it } from "vitest";
import { LifeSim } from "./engine";
import { simulate } from "./simulate";
import corePack from "../packs/core.json";
import type { EventPack } from "./types";

const pack = corePack as EventPack;

/** Fixed-seed batch run: deterministic across runs and machines. */
const LIVES = 600;
const report = simulate({ lives: LIVES, packs: [pack], seedBase: 101 });

describe("event distribution (seeded simulation of many lives)", () => {
  it("is fully deterministic for a fixed seed base", () => {
    const a = simulate({ lives: 50, packs: [pack], seedBase: 777 });
    const b = simulate({ lives: 50, packs: [pack], seedBase: 777 });
    expect(a.totalFires).toBe(b.totalFires);
    for (const [id, s] of a.events) {
      expect(b.events.get(id)?.fires, id).toBe(s.fires);
    }
  });

  it("every drawable event fires at least once across the batch", () => {
    for (const ev of pack.events) {
      const stats = report.events.get(ev.id);
      expect(stats, ev.id).toBeDefined();
      expect(stats!.fires, `event "${ev.id}" never fired`).toBeGreaterThan(0);
    }
  });

  it("no single event dominates the event mix", () => {
    for (const e of report.events.values()) {
      expect(e.share, e.id).toBeLessThan(0.15);
    }
  });

  it("repeatable events don't spam: bounded per-life counts", () => {
    for (const e of report.events.values()) {
      // job_hunt is intentionally unbounded-ish: it must refire while the
      // character remains unemployed, so it gets a looser cap.
      const cap = e.id === "job_hunt" ? 8 : 5.5;
      expect(e.perLife, e.id).toBeLessThan(cap);
      expect(e.maxPerLife, e.id).toBeLessThanOrEqual(14);
    }
  });

  it("guarantees milestone events via `forced`", () => {
    const school = report.events.get("start_school")!;
    expect(school.lifeRate).toBe(1);
    expect(report.neverSchooled).toBe(0);
    expect(school.minAge).toBe(5);
    // Graduation reaches nearly everyone who stays in school (the rest died
    // or were jailed before the 17-19 window).
    expect(report.events.get("graduation")!.lifeRate).toBeGreaterThan(0.7);
  });

  it("keeps a sane quiet-year share and event cadence", () => {
    const quiet = report.quietYears / report.totalYears;
    expect(quiet).toBeGreaterThan(0.15);
    expect(quiet).toBeLessThan(0.6);
    expect(report.eventsPerLife).toBeGreaterThan(15);
    expect(report.eventsPerLife).toBeLessThan(80);
  });

  it("produces a plausible life-course reachability profile", () => {
    expect(report.everEmployed).toBeGreaterThan(0.7);
    expect(report.everMarried).toBeGreaterThan(0.4);
    expect(report.meanAge).toBeGreaterThan(55);
  });
});

describe("selection mechanics", () => {
  it("cooldown enforces a minimum gap between firings", () => {
    const p: EventPack = {
      id: "t",
      name: "t",
      version: "1",
      events: [
        {
          id: "tick",
          title: "t",
          description: "t",
          weight: 1000,
          cooldown: 5,
          choices: [{ id: "x", text: "x", result: "r" }],
        },
      ],
    };
    const sim = new LifeSim([p], { seed: 9 });
    const ages: number[] = [];
    let guard = 0;
    while (sim.character.alive && sim.character.age < 40 && guard++ < 200) {
      if (sim.pending) {
        ages.push(sim.character.age);
        sim.resolve("x");
      } else {
        sim.ageUp();
      }
    }
    expect(ages.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < ages.length; i++) {
      expect(ages[i] - ages[i - 1]).toBeGreaterThanOrEqual(5);
    }
  });

  it("repeatDecay shrinks effective weight after each firing", () => {
    const p: EventPack = {
      id: "t",
      name: "t",
      version: "1",
      events: [
        {
          id: "decaying",
          title: "t",
          description: "t",
          weight: 10,
          repeatDecay: 0.5,
          // forced so the event fires deterministically every eligible year
          forced: true,
          conditions: { kind: "age", min: 1 },
          choices: [{ id: "x", text: "x", result: "r" }],
        },
      ],
    };
    const sim = new LifeSim([p], { seed: 3 });
    const weight = () =>
      sim.eligibleEvents().find((e) => e.event.id === "decaying")!.weight;
    for (let k = 0; k < 3; k++) {
      let guard = 0;
      while (!sim.pending && guard++ < 10) sim.ageUp();
      expect(sim.pending?.event.id).toBe("decaying");
      sim.resolve("x");
    }
    expect(weight()).toBeCloseTo(10 * 0.5 ** 3, 5);
  });

  it("forced events bypass the quiet draw entirely", () => {
    const p: EventPack = {
      id: "t",
      name: "t",
      version: "1",
      events: [
        {
          id: "milestone",
          title: "m",
          description: "m",
          weight: 1,
          forced: true,
          conditions: { kind: "age", min: 10, max: 10 },
          choices: [{ id: "x", text: "x", result: "r" }],
        },
      ],
    };
    // Quiet floor (5) outweighs weight 1 ten-fold; without `forced` the event
    // would usually be skipped. With it, it always fires the year it is
    // eligible, across many seeds.
    for (let seed = 0; seed < 25; seed++) {
      const sim = new LifeSim([p], { seed });
      let firedAge = -1;
      let guard = 0;
      while (sim.character.alive && sim.character.age < 20 && guard++ < 100) {
        if (sim.pending) {
          expect(sim.pending.event.id).toBe("milestone");
          firedAge = sim.character.age;
          sim.resolve("x");
        } else {
          sim.ageUp();
        }
      }
      expect(firedAge).toBe(10);
    }
  });

  it("goto cannot re-enter a spent once event", () => {
    const p: EventPack = {
      id: "t",
      name: "t",
      version: "1",
      events: [
        {
          id: "loop",
          title: "l",
          description: "l",
          weight: 0,
          choices: [{ id: "x", text: "x", result: "r", goto: "once_ev" }],
        },
        {
          id: "once_ev",
          title: "o",
          description: "o",
          weight: 0,
          once: true,
          choices: [
            { id: "x", text: "x", result: "r", goto: "loop" },
          ],
        },
      ],
    };
    const sim = new LifeSim([p], { seed: 1 });
    // Trigger once_ev directly via a forced manual chain.
    (sim as unknown as { chain: (id: string, d: number) => void }).chain("once_ev", 0);
    expect(sim.pending?.event.id).toBe("once_ev");
    sim.resolve("x"); // chains to loop, which chains back to spent once_ev
    expect(sim.pending?.event.id).toBe("loop");
    sim.resolve("x"); // loop -> once_ev must be skipped (once spent)
    expect(sim.pending).toBeNull();
  });

  it("ex-prisoners regain the seeking_work flag on release", () => {
    const sim = new LifeSim([pack], { seed: 21 });
    sim.character.flags.in_prison = true;
    sim.character.flags.sentence = 1;
    sim.ageUp();
    expect(sim.character.flags.in_prison).toBeUndefined();
    expect(sim.character.flags.seeking_work).toBe(true);
  });
});
