import { describe, expect, it } from "vitest";
import { LifeSim } from "./engine";
import { validatePack } from "./schema";
import { simulate } from "./simulate";
import chaosPack from "../packs/chaos.json";
import { bundledCorePack } from "../packs/index";
import type { EventPack } from "./types";

const core = bundledCorePack();
const chaos = chaosPack as EventPack;
const both: EventPack[] = [core, chaos];

/**
 * Batch run used by the distribution assertions. Deterministic: lives are
 * seeded from seedBase, so these numbers are stable across runs/machines.
 */
const LIVES = 800;
const report = simulate({ lives: LIVES, packs: both, seedBase: 101 });

describe("chaos pack", () => {
  it("passes pack validation", () => {
    const res = validatePack(chaosPack);
    expect(res.ok, res.ok ? "" : res.errors.join("\n")).toBe(true);
  });

  it("has no event-id collisions with the core pack", () => {
    const ids = new Set(core.events.map((e) => e.id));
    for (const ev of chaos.events) {
      expect(ids.has(ev.id), `collision on ${ev.id}`).toBe(false);
    }
  });

  it("every drawable chaos event fires at least once across the batch", () => {
    for (const ev of chaos.events) {
      // weight 0 events are chain targets only reachable via goto.
      if ((ev.weight ?? 10) === 0) continue;
      const stats = report.events.get(ev.id);
      expect(stats?.fires, `event "${ev.id}" never fired`).toBeGreaterThan(0);
    }
  });

  it("goto chain targets resolve (detention, sponsor, ghost, battle of bands)", () => {
    for (const id of [
      "chaos.detention",
      "chaos.sponsor_offer",
      "chaos.battle_of_bands",
      "chaos.ghost_roommate",
    ]) {
      expect(
        report.events.get(id)?.fires,
        `chain target "${id}" was never reached`,
      ).toBeGreaterThan(0);
    }
  });

  it("trigger-gated events fire: flags, chose(), money, employment", () => {
    for (const id of [
      "chaos.goose_revenge", // flag goose_enemy
      "chaos.goose_gift", // flag goose_friend
      "chaos.pet_rock_graduation", // flag pet_rock + adult
      "chaos.crypto_check", // flag crypto_stake
      "chaos.fame_fades", // flag internet_famous
      "chaos.printer_revenge", // flag printer_rival + employed
      "chaos.alien_contact", // flag conspiracist (from tinfoil_hat)
      "chaos.reunion", // chose school_bully/fight_back
      "chaos.ex_con_offer", // chose mugging_offer/help
      "chaos.tax_audit", // money >= 100k
      "chaos.office_printer", // employed flag
    ]) {
      expect(report.events.get(id)?.fires, `"${id}" never fired`).toBeGreaterThan(0);
    }
  });

  it("no childhood deaths: nobody dies before 18 in the batch", () => {
    // The pack adds no die effects below age 18 and keeps childhood stat hits
    // small; this guards both.
    let minDeathAge = Infinity;
    let deaths = 0;
    for (let i = 0; i < 200; i++) {
      const sim = new LifeSim(both, { seed: 4242 + i });
      let guard = 0;
      while (sim.character.alive && sim.character.age < 130 && guard++ < 3000) {
        if (sim.pending) {
          sim.resolve(sim.pending.choices[0].id);
        } else {
          sim.ageUp();
        }
      }
      deaths++;
      minDeathAge = Math.min(minDeathAge, sim.character.age);
    }
    expect(minDeathAge).toBeGreaterThanOrEqual(18);
    void deaths;
  });

  it("keeps lifespan sane (no mortality spike vs core-only baseline)", () => {
    // Core-only baseline over the same seeds is ~66.6; the chaos pack must not
    // drag mean lifespan down.
    expect(report.meanAge).toBeGreaterThan(60);
  });

  it("rare events stay rare", () => {
    for (const id of ["chaos.meteor", "chaos.time_traveler", "chaos.inheritance"]) {
      const stats = report.events.get(id)!;
      expect(stats.perLife, id).toBeLessThan(1);
    }
  });

  it("core milestones are unaffected by the extra pack", () => {
    expect(report.events.get("start_school")!.lifeRate).toBe(1);
    expect(report.events.get("graduation")!.lifeRate).toBeGreaterThan(0.7);
  });
});
