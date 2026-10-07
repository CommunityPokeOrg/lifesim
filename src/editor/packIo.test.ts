import { describe, expect, it } from "vitest";
import { nodesToPack, packToNodes } from "./packIo";
import { effectivePack, sectionKey } from "../engine/packs";
import { validatePackFile } from "../engine/schema";
import type { PackFile, WorldLaw } from "../engine/types";

describe("world law editor round-trip", () => {
  it("preserves top-level and section laws, including sections without event nodes", () => {
    const law = (id: string): WorldLaw => ({ id, effects: [{ kind: "money", delta: -1 }] });
    const file: PackFile = {
      id: "world", name: "World", version: "1", laws: [law("top")],
      sections: [
        { id: "laws_only", name: "Laws only", laws: [law("scoped")] },
        { id: "mixed", name: "Mixed", laws: [law("mixed_law")], events: [{
          id: "event", title: "Event", description: "Event",
          choices: [{ id: "ok", text: "OK", result: "OK" }],
        }] },
      ],
    };
    const imported = validatePackFile(file);
    if (!imported.ok) throw new Error(imported.errors.join("\n"));
    const { pack, sections } = imported.loaded;
    const { events: _events, ...meta } = pack;
    const exported = nodesToPack(
      packToNodes(pack, sections), meta,
      new Map(sections.map((s) => [s.id, s.name])),
      new Map(sections.map((s) => [s.id, []])),
      new Map(sections.map((s) => [s.id, (pack.laws ?? []).filter((l) => s.lawIds.includes(l.id))])),
    );
    expect(exported.laws).toEqual(file.laws);
    expect(exported.sections?.find((s) => s.id === "laws_only")?.laws).toEqual(file.sections![0].laws);
    expect(exported.sections?.find((s) => s.id === "mixed")?.laws).toEqual(file.sections![1].laws);
    const reimported = validatePackFile(exported);
    expect(reimported.ok).toBe(true);
    if (reimported.ok) {
      const off = effectivePack(reimported.loaded, new Set([sectionKey("world", "laws_only")]));
      expect(off.laws?.map((l) => l.id)).toEqual(["top", "mixed_law"]);
    }
  });

  it("preserves a flat laws-only pack with no graph nodes", () => {
    const law: WorldLaw = { id: "flat", drift: [{ stat: "health", amount: -1 }] };
    const file = nodesToPack([], { id: "world", name: "World", version: "1", laws: [law] });
    expect(file.laws).toEqual([law]);
    expect(validatePackFile(file).ok).toBe(true);
  });
});
