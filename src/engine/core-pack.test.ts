import { describe, expect, it } from "vitest";
import { loadBundledPacks } from "../packs/index";

/**
 * Content-quality rules for bundled packs, kept out of validatePackFile so
 * user-uploaded mods aren't forced to meet the same bar. Packs are loaded
 * through the real bundled-pack loader, so nested section files are
 * resolved and validated exactly as at runtime (and an invalid bundled
 * pack throws inside loadBundledPacks, failing here).
 */
const packs = loadBundledPacks();

describe("bundled event packs", () => {
  it("all bundled packs load and pass schema validation", () => {
    expect(packs.length).toBeGreaterThan(0);
  });

  it("every choice event offers at least 2 options", () => {
    for (const { pack } of packs) {
      const offenders = pack.events.filter((e) => e.choices.length < 2);
      expect(
        offenders.map((e) => e.id),
        `${pack.id}: a single button isn't a choice`,
      ).toEqual([]);
    }
  });
});
