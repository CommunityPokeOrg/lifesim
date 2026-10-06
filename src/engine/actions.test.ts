import { describe, expect, it } from "vitest";
import {
  actionsLeft,
  applyForJob,
  buyItem,
  itemStatus,
  jobStatus,
  listActions,
  performAction,
  quitJob,
  ACTIONS_PER_YEAR,
} from "./actions";
import { LifeSim } from "./engine";
import { validatePack } from "./schema";
import actionsPack from "../packs/actions.json";
import corePack from "../packs/core.json";
import type { EventPack } from "./types";

const packs = [corePack as EventPack, actionsPack as EventPack];

function life(seed = 42) {
  return new LifeSim(packs, { seed, name: "Test" });
}

/** Age the sim to a target age, auto-resolving events with the first choice. */
function ageTo(sim: LifeSim, age: number) {
  let guard = 0;
  while (sim.character.alive && sim.character.age < age && guard++ < 500) {
    if (sim.pending) sim.resolve(sim.pending.choices[0].id);
    else sim.ageUp();
  }
  // Leave the sim in an actionable state (nothing pending).
  while (sim.pending) sim.resolve(sim.pending.choices[0].id);
}

describe("actions pack", () => {
  it("passes pack validation", () => {
    const res = validatePack(actionsPack);
    expect(res.ok, res.ok ? "" : res.errors.join("\n")).toBe(true);
  });

  it("registers actions, items and jobs on the sim", () => {
    const sim = life();
    expect(sim.actions.size).toBeGreaterThan(5);
    expect(sim.items.size).toBeGreaterThan(5);
    expect(sim.jobs.size).toBeGreaterThan(5);
  });
});

describe("per-year actions", () => {
  it("gates actions by age conditions", () => {
    const sim = life();
    const study = listActions(sim).find((s) => s.action.id === "act_study")!;
    expect(study.eligible).toBe(false); // age 0 < 5
    ageTo(sim, 6);
    expect(listActions(sim).find((s) => s.action.id === "act_study")!.eligible).toBe(true);
  });

  it("limits each action to once per year and shares the life budget", () => {
    const sim = life();
    ageTo(sim, 20);
    expect(actionsLeft(sim)).toBe(ACTIONS_PER_YEAR);
    expect(performAction(sim, "act_study").ok).toBe(true);
    // Same action can't be repeated in the same year.
    const again = performAction(sim, "act_study");
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/this year/);
    expect(actionsLeft(sim)).toBe(ACTIONS_PER_YEAR - 1);
  });

  it("resets uses and budget on the next year", () => {
    const sim = life();
    ageTo(sim, 20);
    for (const id of ["act_study", "act_exercise", "act_socialize"]) {
      performAction(sim, id);
      while (sim.pending) sim.resolve(sim.pending.choices[0].id);
    }
    expect(actionsLeft(sim)).toBe(0);
    // Non-budget actions are unaffected by the life budget.
    sim.character.money = 2000;
    expect(performAction(sim, "act_deposit").ok).toBe(true);
    sim.ageUp();
    while (sim.pending) sim.resolve(sim.pending.choices[0].id);
    expect(actionsLeft(sim)).toBe(ACTIONS_PER_YEAR);
    expect(performAction(sim, "act_study").ok).toBe(true);
  });

  it("records history so `chose` conditions can see past actions", () => {
    const sim = life();
    ageTo(sim, 20);
    performAction(sim, "act_study");
    expect(sim.character.history["act_study"]).toBe("done");
  });
});

describe("jobs", () => {
  it("requires minimum age", () => {
    const sim = life();
    expect(jobStatus(sim, sim.jobs.get("retail_clerk")!).eligible).toBe(false);
    ageTo(sim, 16);
    expect(jobStatus(sim, sim.jobs.get("retail_clerk")!).eligible).toBe(true);
  });

  it("gates high-end jobs on education and stats", () => {
    const sim = life();
    ageTo(sim, 30);
    const doctor = jobStatus(sim, sim.jobs.get("doctor")!);
    expect(doctor.eligible).toBe(false);
    // Degree + high smarts opens the door.
    sim.character.flags.degree = true;
    sim.character.stats.smarts = 85;
    expect(jobStatus(sim, sim.jobs.get("doctor")!).eligible).toBe(true);
  });

  it("gates delivery driver on owning a car (shop-job interaction)", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.money = 50000;
    expect(jobStatus(sim, sim.jobs.get("delivery_driver")!).eligible).toBe(false);
    buyItem(sim, "used_car");
    expect(jobStatus(sim, sim.jobs.get("delivery_driver")!).eligible).toBe(true);
  });

  it("hires or rejects, and hired jobs feed the salary tick + job events", () => {
    // Try several seeds until one hire lands.
    let sim = life(1);
    let hired = false;
    for (let seed = 1; seed < 40 && !hired; seed++) {
      sim = life(seed);
      ageTo(sim, 18);
      // Clean slate: ignore any event-driven employment.
      const c0 = sim.character;
      delete c0.flags.employed;
      delete c0.flags.salary;
      delete c0.flags.job;
      c0.flags.seeking_work = true;
      applyForJob(sim, "retail_clerk");
      hired = c0.history["job_retail_clerk"] === "hired";
    }
    expect(hired).toBe(true);
    const c = sim.character;
    expect(c.flags.salary).toBe(19000);
    expect(c.flags.job).toBe("Retail Clerk");
    expect(c.flags.seeking_work).toBeUndefined();
    // Salary arrives on the next age-up (positive money → no debt interest).
    c.money = 5000;
    sim.ageUp();
    expect(c.money).toBe(24000);
    // Employment unlocks the promotion event in the draw pool.
    expect(sim.eligibleEvents().some((e) => e.event.id === "promotion")).toBe(true);
    // One application per job per year.
    const reapply = applyForJob(sim, "retail_clerk");
    expect(reapply.ok).toBe(false);
  });

  it("quit returns the character to the job market", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.flags.employed = true;
    sim.character.flags.salary = 30000;
    sim.character.flags.job = "Retail Clerk";
    expect(quitJob(sim)).toBe(true);
    expect(sim.character.flags.employed).toBeUndefined();
    expect(sim.character.flags.seeking_work).toBe(true);
  });
});

describe("shop", () => {
  it("buys items: cost, ownership flag, one-time + passive effects", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.money = 5000;
    const smarts0 = sim.character.stats.smarts;
    expect(buyItem(sim, "laptop").ok).toBe(true);
    expect(sim.character.money).toBe(4250);
    expect(sim.character.flags.item_laptop).toBe(true);
    expect(sim.character.stats.smarts).toBe(smarts0 + 4);
    // Passive effect applies each year.
    const smarts1 = sim.character.stats.smarts;
    sim.ageUp();
    while (sim.pending) sim.resolve(sim.pending.choices[0].id);
    expect(sim.character.stats.smarts).toBeGreaterThanOrEqual(smarts1 + 1);
    // Can't buy twice.
    expect(itemStatus(sim, sim.items.get("laptop")!).reason).toBe("Owned");
  });

  it("repeatable items respect their per-year limit", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.money = 5000;
    expect(buyItem(sim, "spa_day").ok).toBe(true);
    expect(buyItem(sim, "spa_day").ok).toBe(true);
    expect(buyItem(sim, "spa_day").ok).toBe(false); // usesPerYear 2
  });

  it("blocks purchases the character can't afford", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.money = 100;
    expect(itemStatus(sim, sim.items.get("house")!).eligible).toBe(false);
  });
});

describe("gambling", () => {
  it("gates on age and debt floor", () => {
    const sim = life();
    ageTo(sim, 18);
    sim.character.money = 1000;
    expect(performAction(sim, "act_coinflip").ok).toBe(true);
    expect(sim.character.flags.gambling_count).toBe(1);
  });

  it("allows debt when the action says so (consequence fuel)", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.money = 30;
    expect(performAction(sim, "act_coinflip").ok).toBe(true);
    expect(sim.character.money).toBeLessThan(0);
  });

  it("drives the debt collector event when deep in the hole", () => {
    const sim = life();
    ageTo(sim, 25);
    sim.character.money = -6000;
    expect(sim.eligibleEvents().some((e) => e.event.id === "debt_collector")).toBe(true);
  });

  it("drives the gambling problem event after heavy play", () => {
    const sim = life();
    ageTo(sim, 25);
    sim.character.flags.gambling_count = 9;
    sim.character.money = 50000;
    expect(sim.eligibleEvents().some((e) => e.event.id === "gambling_problem")).toBe(true);
  });
});

describe("savings & investments", () => {
  it("deposits, compounds, and withdraws savings", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.money = 2000;
    expect(performAction(sim, "act_deposit").ok).toBe(true);
    expect(sim.character.money).toBe(1500);
    expect(sim.character.flags.savings).toBe(500);
    sim.ageUp();
    while (sim.pending) sim.resolve(sim.pending.choices[0].id);
    expect(Number(sim.character.flags.savings)).toBeGreaterThan(500);
    const cash = sim.character.money;
    expect(performAction(sim, "act_withdraw").ok).toBe(true);
    expect(sim.character.money).toBeGreaterThan(cash);
    expect(sim.character.flags.savings).toBe(0);
  });

  it("moves money into investments and liquidates via collect", () => {
    const sim = life();
    ageTo(sim, 20);
    sim.character.money = 5000;
    expect(performAction(sim, "act_invest").ok).toBe(true);
    expect(sim.character.flags.invested).toBe(1000);
    expect(performAction(sim, "act_divest").ok).toBe(true);
    expect(sim.character.flags.invested).toBe(0);
  });
});

describe("balance", () => {
  it("a life full of yearly actions doesn't spike early deaths", () => {
    let meanAge = 0;
    let earlyDeaths = 0;
    const LIVES = 60;
    for (let i = 0; i < LIVES; i++) {
      const sim = life(5000 + i);
      let guard = 0;
      while (sim.character.alive && sim.character.age < 130 && guard++ < 400) {
        if (sim.pending) {
          sim.resolve(sim.pending.choices[0].id);
          continue;
        }
        // Do whatever life actions are available, then age up.
        for (const s of listActions(sim, "life")) {
          if (s.eligible) performAction(sim, s.action.id);
        }
        sim.ageUp();
      }
      meanAge += sim.character.age;
      if (sim.character.age < 30) earlyDeaths++;
    }
    meanAge /= LIVES;
    expect(meanAge).toBeGreaterThan(55);
    expect(earlyDeaths).toBeLessThanOrEqual(2);
  });
});
