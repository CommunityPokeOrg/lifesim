import { describe, expect, it } from "vitest";
import { validatePack } from "./schema";
import type { EventPack } from "./types";

/**
 * Content-quality rules for bundled packs, kept out of validatePack so
 * user-uploaded mods aren't forced to meet the same bar.
 */
const packModules = import.meta.glob("../packs/*.json", { eager: true });
const packs = Object.entries(packModules).map(([path, mod]) => ({
  path,
  data: (mod as { default: unknown }).default,
}));

describe("bundled event packs", () => {
  it("all bundled packs pass schema validation", () => {
    for (const { path, data } of packs) {
      const result = validatePack(data);
      expect(result.ok ? [] : result.errors, path).toEqual([]);
    }
  });

  it("every choice event offers at least 2 options", () => {
    for (const { path, data } of packs) {
      const pack = data as EventPack;
      const offenders = pack.events.filter((e) => e.choices.length < 2);
      expect(
        offenders.map((e) => e.id),
        `${path}: a single button isn't a choice`,
      ).toEqual([]);
    }
  });
});
