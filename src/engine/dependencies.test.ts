import { describe, expect, it } from "vitest";
import {
  compareVersions,
  dependencyProblems,
  orderByDependencies,
  satisfiesVersion,
} from "./packs";
import { validatePackFile } from "./schema";
import { evalCondition } from "./conditions";
import { LifeSim } from "./engine";
import { applyForJob, listActions, quitJob } from "./actions";
import type { EventPack, PackFile } from "./types";

const ev = (id: string, extra: object = {}) => ({
  id,
  title: id,
  description: "d",
  weight: 1,
  choices: [{ id: "x", text: "x", result: "r" }],
  ...extra,
});

const packOf = (id: string, version: string, requires?: { pack: string; version?: string }[]): EventPack => ({
  id,
  name: id,
  version,
  requires,
  events: [ev(`${id}.event`)],
});

describe("pack requirements (requires)", () => {
  it("schema accepts requires and flattenPack preserves it", () => {
    const file: PackFile = {
      id: "fraud",
      name: "Fraud",
      version: "1.0.0",
      requires: [{ pack: "white-collar-jobs", version: ">=1.0.0" }, { pack: "core" }],
      events: [ev("fraud.embezzle")],
    };
    const res = validatePackFile(file);
    expect(res.ok, res.ok ? "" : res.errors.join("\n")).toBe(true);
    if (!res.ok) return;
    expect(res.loaded.pack.requires).toEqual([
      { pack: "white-collar-jobs", version: ">=1.0.0" },
      { pack: "core" },
    ]);
  });

  it("rejects a pack that requires itself", () => {
    const res = validatePackFile({
      id: "self",
      name: "s",
      version: "1",
      requires: [{ pack: "self" }],
      events: [ev("self.e")],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes("require itself"))).toBe(true);
  });

  it("dependencyProblems reports missing and mismatched requirements", () => {
    const base = packOf("white-collar-jobs", "1.2.0");
    const ok = packOf("white-collar-fraud", "1.0.0", [{ pack: "white-collar-jobs", version: ">=1.0.0" }]);
    expect(dependencyProblems([base, ok])).toEqual([]);

    const missing = packOf("lonely", "1.0.0", [{ pack: "absent" }]);
    expect(dependencyProblems([missing]).some((p) => p.includes("not loaded"))).toBe(true);

    const stale = packOf("needs-new", "1.0.0", [{ pack: "white-collar-jobs", version: ">=2.0.0" }]);
    const probs = dependencyProblems([base, stale]);
    expect(probs.some((p) => p.includes(">=2.0.0") && p.includes("v1.2.0"))).toBe(true);
  });

  it("dependencyProblems reports dependency cycles", () => {
    const a = packOf("a", "1", [{ pack: "b" }]);
    const b = packOf("b", "1", [{ pack: "a" }]);
    expect(dependencyProblems([a, b]).some((p) => p.includes("circular"))).toBe(true);
  });

  it("orderByDependencies loads requirements first, stable otherwise", () => {
    const a = packOf("base", "1");
    const b = packOf("mid", "1", [{ pack: "base" }]);
    const c = packOf("top", "1", [{ pack: "mid" }, { pack: "base" }]);
    const d = packOf("solo", "1");
    const ordered = orderByDependencies([c, d, b, a]).map((p) => p.id);
    expect(ordered.indexOf("base")).toBeLessThan(ordered.indexOf("mid"));
    expect(ordered.indexOf("mid")).toBeLessThan(ordered.indexOf("top"));
    // Out-of-set requirements don't block ordering.
    const ghost = packOf("ghost", "1", [{ pack: "absent" }]);
    expect(orderByDependencies([ghost, a])).toHaveLength(2);
  });

  it("LifeSim exposes unmet requirements without refusing to run", () => {
    const sim = new LifeSim([packOf("fraud", "1", [{ pack: "white-collar-jobs" }])], { seed: 1 });
    expect(sim.unmetRequirements.some((p) => p.includes("white-collar-jobs"))).toBe(true);
    expect(sim.events.has("fraud.event")).toBe(true);
    const fine = new LifeSim([packOf("core", "1")], { seed: 1 });
    expect(fine.unmetRequirements).toEqual([]);
  });
});

describe("version ranges", () => {
  it("compares numeric versions", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0", "2.0.0")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("satisfies common range forms", () => {
    expect(satisfiesVersion("1.2.0", ">=1.0.0")).toBe(true);
    expect(satisfiesVersion("1.2.0", ">=2.0.0")).toBe(false);
    expect(satisfiesVersion("1.2.0", "1.2.0")).toBe(true);
    expect(satisfiesVersion("1.2.1", "1.2.0")).toBe(false);
    expect(satisfiesVersion("1.9.0", "^1.2.0")).toBe(true);
    expect(satisfiesVersion("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfiesVersion("0.2.9", "^0.2.3")).toBe(true);
    expect(satisfiesVersion("0.3.0", "^0.2.3")).toBe(false);
    expect(satisfiesVersion("1.2.9", "~1.2.0")).toBe(true);
    expect(satisfiesVersion("1.3.0", "~1.2.0")).toBe(false);
    expect(satisfiesVersion("1.0.0", "<2.0")).toBe(true);
  });
});

describe("job prerequisites (runtime gates)", () => {
  /** Hire into a job deterministically by retrying across seeds. */
  function hired(pack: EventPack, jobId: string): LifeSim {
    for (let seed = 1; seed < 60; seed++) {
      const sim = new LifeSim([pack], { seed });
      sim.character.age = 30;
      sim.character.flags.degree = true;
      const res = applyForJob(sim, jobId);
      if (res.ok && sim.character.flags.employed) return sim;
    }
    throw new Error("could not get hired in 60 seeds");
  }

  const jobsPack: EventPack = {
    id: "white-collar-jobs",
    name: "White Collar Jobs",
    version: "1.0.0",
    events: [ev("wcj.noop")],
    jobs: [
      {
        id: "analyst",
        title: "Financial Analyst",
        salary: 72000,
        field: "white_collar",
        conditions: { kind: "age", min: 21 },
      },
      {
        id: "frycook",
        title: "Fry Cook",
        salary: 22000,
        field: "service",
        conditions: { kind: "age", min: 16 },
      },
    ],
    actions: [
      {
        id: "act_embezzle",
        title: "Embezzle from the company",
        category: "crime",
        conditions: { kind: "job", field: "white_collar" },
        hint: "Needs a white-collar job",
        result: "You skim a little off the ledger.",
      },
      {
        id: "act_insider_trade",
        title: "Trade on insider info",
        category: "crime",
        conditions: {
          kind: "all",
          conditions: [
            { kind: "job", id: "analyst" },
            { kind: "stat", stat: "smarts", op: "gte", value: 0 },
          ],
        },
        result: "You buy before the announcement.",
      },
      {
        id: "act_promotion_track",
        title: "Apply to the partner track",
        category: "work",
        conditions: { kind: "job", id: "analyst", ever: true },
        result: "Your analyst years count.",
      },
    ],
  };

  it("bare job condition means any current employment", () => {
    const sim = new LifeSim([jobsPack], { seed: 1 });
    expect(evalCondition({ kind: "job" }, sim.character)).toBe(false);
    sim.character.flags.employed = true;
    expect(evalCondition({ kind: "job" }, sim.character)).toBe(true);
  });

  it("hiring records job_id, job_field and the career history", () => {
    const sim = hired(jobsPack, "analyst");
    expect(sim.character.flags.job_id).toBe("analyst");
    expect(sim.character.flags.job).toBe("Financial Analyst");
    expect(sim.character.flags.job_field).toBe("white_collar");
    const hist = sim.character.flags.job_history as { id: string; field?: string }[];
    expect(hist).toEqual([{ id: "analyst", title: "Financial Analyst", field: "white_collar" }]);
    expect(sim.character.history.job_analyst).toBe("hired");
  });

  it("field/id matchers gate actions until the right job is held", () => {
    const sim = new LifeSim([jobsPack], { seed: 7 });
    sim.character.age = 30;
    const status = () => new Map(listActions(sim).map((s) => [s.action.id, s.eligible]));
    // Unemployed: white-collar-gated actions are locked.
    expect(status().get("act_embezzle")).toBe(false);
    expect(status().get("act_insider_trade")).toBe(false);

    // Wrong field: service job doesn't satisfy a white_collar gate.
    const cook = hired(jobsPack, "frycook");
    expect(evalCondition({ kind: "job", field: "white_collar" }, cook.character)).toBe(false);
    expect(evalCondition({ kind: "job", id: "analyst" }, cook.character)).toBe(false);
    expect(evalCondition({ kind: "job", field: "service" }, cook.character)).toBe(true);

    // Right job: both gates open.
    const analyst = hired(jobsPack, "analyst");
    expect(evalCondition({ kind: "job", field: "white_collar" }, analyst.character)).toBe(true);
    expect(evalCondition({ kind: "job", id: "analyst" }, analyst.character)).toBe(true);
    expect(evalCondition({ kind: "job", title: "Financial Analyst" }, analyst.character)).toBe(true);
    expect(evalCondition({ kind: "job", field: "service" }, analyst.character)).toBe(false);
  });

  it("ever tracks past jobs; quitting locks current-job gates but keeps history", () => {
    const sim = hired(jobsPack, "analyst");
    expect(quitJob(sim)).toBe(true);
    expect(sim.character.flags.job_id).toBeUndefined();
    expect(sim.character.flags.job_field).toBeUndefined();
    expect(evalCondition({ kind: "job", field: "white_collar" }, sim.character)).toBe(false);
    expect(evalCondition({ kind: "job", id: "analyst", ever: true }, sim.character)).toBe(true);
    expect(evalCondition({ kind: "job", field: "white_collar", ever: true }, sim.character)).toBe(true);
    expect(evalCondition({ kind: "job", id: "frycook", ever: true }, sim.character)).toBe(false);
  });
});
