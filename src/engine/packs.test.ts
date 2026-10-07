import { describe, expect, it } from "vitest";
import { effectivePack, flattenPack, resolveSectionSrcs, sectionKey } from "./packs";
import { validatePack, validatePackFile } from "./schema";
import { LifeSim } from "./engine";
import type { PackFile } from "./types";

const ev = (id: string, extra: object = {}) => ({
  id,
  title: id,
  description: "d",
  weight: 1,
  choices: [{ id: "x", text: "x", result: "r" }],
  ...extra,
});

const nested: PackFile = {
  id: "core",
  name: "Core",
  version: "2.0.0",
  sections: [
    {
      id: "school",
      name: "School",
      events: [ev("start_school"), ev("graduation")],
    },
    {
      id: "health",
      name: "Health",
      events: [ev("checkup")],
      ailments: [
        {
          id: "flu",
          name: "Flu",
          kind: "physical",
          course: "acute",
          severity: 1,
          durationYears: [1, 2],
          treatable: true,
        },
      ],
    },
  ],
};

describe("nested packs", () => {
  it("validates and flattens sections into one EventPack", () => {
    const res = validatePackFile(nested);
    expect(res.ok, res.ok ? "" : res.errors.join("\n")).toBe(true);
    if (!res.ok) return;
    expect(res.loaded.pack.events.map((e) => e.id)).toEqual([
      "start_school",
      "graduation",
      "checkup",
    ]);
    expect(res.loaded.pack.ailments?.map((a) => a.id)).toEqual(["flu"]);
    expect(res.loaded.sections.map((s) => s.id)).toEqual(["school", "health"]);
    expect(res.loaded.sections[0].eventIds).toEqual(["start_school", "graduation"]);
  });

  it("validatePack accepts nested files (back-compat entry point)", () => {
    const res = validatePack(nested);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.pack.events).toHaveLength(3);
  });

  it("disabling a section removes its events and ailments", () => {
    const res = validatePackFile(nested);
    if (!res.ok) throw new Error("invalid");
    const disabled = new Set([sectionKey("core", "health")]);
    const p = effectivePack(res.loaded, disabled);
    expect(p.events.map((e) => e.id)).toEqual(["start_school", "graduation"]);
    expect(p.ailments).toBeUndefined();
    // A sim built on the filtered pack can't contract the removed disease.
    const s = new LifeSim([p], { seed: 1 });
    s.applyEffects([{ kind: "ailment", ailment: "flu" }]);
    expect(s.character.ailments).toHaveLength(0);
  });

  it("rejects duplicate event ids across sections", () => {
    const bad: PackFile = {
      id: "b",
      name: "b",
      version: "1",
      sections: [
        { id: "a", name: "a", events: [ev("same")] },
        { id: "b", name: "b", events: [ev("same")] },
      ],
    };
    const res = validatePackFile(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes("duplicate event id"))).toBe(true);
  });

  it("rejects empty sections and duplicate section ids", () => {
    const res = validatePackFile({
      id: "b",
      name: "b",
      version: "1",
      sections: [
        { id: "a", name: "a", events: [ev("one")] },
        { id: "a", name: "a2", events: [ev("two")] },
        { id: "empty", name: "e" },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes("duplicate section id"))).toBe(true);
      expect(res.errors.some((e) => e.includes("empty"))).toBe(true);
    }
  });

  it("gotos may target events in other sections", () => {
    const res = validatePackFile({
      id: "x",
      name: "x",
      version: "1",
      sections: [
        { id: "a", name: "a", events: [ev("from", { choices: [{ id: "c", text: "t", result: "r", goto: "to" }] })] },
        { id: "b", name: "b", events: [ev("to")] },
      ],
    });
    expect(res.ok, res.ok ? "" : res.errors.join("\n")).toBe(true);
  });

  it("resolveSectionSrcs merges sibling files into the manifest", () => {
    const manifest: PackFile = {
      id: "core",
      name: "Core",
      version: "1",
      sections: [
        { id: "jobs", name: "Jobs", src: "jobs.json" },
        { id: "crime", name: "Crime", events: [ev("mug")] },
      ],
    };
    const resolved = resolveSectionSrcs(manifest, (src) =>
      src === "jobs.json" ? { events: [ev("job_hunt")] } : undefined,
    );
    const flat = flattenPack(resolved);
    expect(flat.pack.events.map((e) => e.id)).toEqual(["job_hunt", "mug"]);
  });

  it("mixed packs: top-level events plus sections coexist", () => {
    const res = validatePackFile({
      id: "m",
      name: "m",
      version: "1",
      events: [ev("top")],
      sections: [{ id: "s", name: "s", events: [ev("nested_e")] }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.loaded.pack.events.map((e) => e.id)).toEqual(["top", "nested_e"]);
  });
});
