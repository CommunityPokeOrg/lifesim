import { describe, expect, it } from "vitest";
import { LifeSim } from "./engine";
import { eventPackSchema, validatePack, validatePackFile } from "./schema";
import { effectivePack, resolveSectionSrcs, sectionKey } from "./packs";
import { hashString, seededNoise } from "./rng";
import { applyWorldLaws, lawIsDue } from "./world";
import type { Effect, EventPack, PackFile, WorldLaw, WorldLawEffect } from "./types";

/** A pack with one always-eligible event, plus any laws under test. */
function worldPack(laws: WorldLaw[] = []): EventPack {
  return {
    id: "world_test",
    name: "World Test",
    version: "1.0.0",
    events: [
      {
        id: "only",
        title: "Only",
        description: "The only event.",
        weight: 1000,
        choices: [{ id: "x", text: "x", result: "ok" }],
      },
    ],
    laws,
  };
}

/** A sim running only `worldPack(laws)`. */
function life(laws: WorldLaw[], seed: number): LifeSim {
  return new LifeSim([worldPack(laws)], { seed });
}

/** Advance `years`, auto-resolving events; returns the fired event ids. */
function drive(sim: LifeSim, years: number): string[] {
  const fired: string[] = [];
  for (let i = 0; i < years; i++) {
    while (sim.pending) {
      fired.push(sim.pending.event.id);
      sim.resolve(sim.pending.choices[0].id);
    }
    sim.ageUp();
  }
  while (sim.pending) {
    fired.push(sim.pending.event.id);
    sim.resolve(sim.pending.choices[0].id);
  }
  return fired;
}

describe("world law schema", () => {
  it("accepts a well-formed law", () => {
    const res = validatePack(
      worldPack([
        { id: "inflation", title: "Prices rose.", effects: [{ kind: "money", delta: -10 }] },
      ]),
    );
    expect(res.ok, res.ok ? "" : res.errors.join("\n")).toBe(true);
    if (res.ok) {
      expect(res.pack.laws?.[0].id).toBe("inflation");
      const sim = new LifeSim([res.pack], { seed: 1 });
      sim.ageUp();
      expect(sim.character.money).toBe(-10);
    }
  });

  it("rejects a law with no effects or drift", () => {
    const res = validatePack(worldPack([{ id: "noop", title: "Nothing happens" }]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join("\n")).toMatch(/needs "effects" or "drift"/);
  });

  it("rejects duplicate law ids in the shared namespace", () => {
    const res = validatePack(
      worldPack([
        { id: "dup", effects: [{ kind: "stat", stat: "health", delta: -1 }] },
        { id: "dup", drift: [{ stat: "happiness", amount: -1 }] },
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join("\n")).toMatch(/duplicate id "dup"/);
  });

  it("rejects an inverted age window", () => {
    const res = validatePack(
      worldPack([
        {
          id: "bad",
          minAge: 40,
          maxAge: 10,
          effects: [{ kind: "stat", stat: "health", delta: -1 }],
        },
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join("\n")).toMatch(/minAge must be less than maxAge/);
  });
});

describe("law cadence", () => {
  it("anchors everyYears to minAge", () => {
    const law: WorldLaw = { id: "l", minAge: 2, everyYears: 3 };
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((a) => lawIsDue(law, a))).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it("treats maxAge as exclusive", () => {
    const law: WorldLaw = { id: "l", minAge: 0, maxAge: 3 };
    expect([0, 1, 2, 3].map((a) => lawIsDue(law, a))).toEqual([true, true, true, false]);
  });

  it("fires once per due year during a life", () => {
    const sim = life(
      [
        {
          id: "tick",
          minAge: 1,
          everyYears: 3,
          effects: [{ kind: "counter", flag: "ticks", delta: 1 }],
        },
      ],
      1,
    );
    drive(sim, 7); // ages 1..7 → due at 1, 4, 7
    expect(Number(sim.character.flags.ticks ?? 0)).toBe(3);
  });

  it("honors conditions and chance", () => {
    const sim = life(
      [
        {
          id: "gated",
          conditions: { kind: "stat", stat: "smarts", op: "gte", value: 100 },
          effects: [{ kind: "counter", flag: "gated_ticks", delta: 1 }],
        },
        { id: "never", chance: 0, effects: [{ kind: "counter", flag: "never_ticks", delta: 1 }] },
        { id: "always", chance: 100, effects: [{ kind: "counter", flag: "always_ticks", delta: 1 }] },
      ],
      1,
    );
    drive(sim, 5);
    expect(sim.character.flags.gated_ticks).toBeUndefined();
    expect(sim.character.flags.never_ticks).toBeUndefined();
    expect(Number(sim.character.flags.always_ticks ?? 0)).toBe(5);
  });
});

describe("drift", () => {
  it("clamps stats to 0..100", () => {
    const sim = life([{ id: "boost", drift: [{ stat: "happiness", amount: 100 }] }], 3);
    sim.character.stats.happiness = 90;
    sim.character.age = 1;
    applyWorldLaws(sim);
    expect(sim.character.stats.happiness).toBe(100);
  });

  it("applies a deterministic jittered drift", () => {
    const laws: WorldLaw[] = [{ id: "drift", drift: [{ stat: "health", amount: -2, jitter: 5 }] }];
    const a = life(laws, 99);
    const b = life(laws, 99);
    a.character.stats.health = 80;
    b.character.stats.health = 80;
    a.character.age = 1;
    b.character.age = 1;
    applyWorldLaws(a);
    applyWorldLaws(b);
    expect(a.character.stats.health).toBe(b.character.stats.health);
  });

  it("gives repeated drift entries on one stat independent jitter", () => {
    const sim = life([{ id: "spread", drift: [
      { stat: "happiness", amount: 0, jitter: 10 },
      { stat: "happiness", amount: 0, jitter: 10 },
    ] }], 99);
    sim.character.age = 1;
    sim.character.stats.happiness = 50;
    const deltas = [0, 1].map((index) =>
      Math.round((seededNoise(99, "drift", "spread", "happiness", index, 1) * 2 - 1) * 10),
    );
    expect(deltas[0]).not.toBe(deltas[1]);
    applyWorldLaws(sim);
    expect(sim.character.stats.happiness).toBe(50 + deltas[0] + deltas[1]);
  });
});

describe("stream isolation", () => {
  it("world laws do not advance the event RNG", () => {
    const pack = worldPack();
    pack.events.push({ ...pack.events[0], id: "another", weight: 500 });
    const a = new LifeSim([pack], { seed: 12345 });
    const b = new LifeSim(
      [
        { ...pack, laws: [
          {
            id: "noise",
            chance: 50,
            effects: [{ kind: "counter", flag: "world_ticks", delta: 1 }],
          },
        ] },
      ],
      { seed: 12345 },
    );
    // The two lives share one identical entropy stream…
    expect(a.rng()).toBe(b.rng());
    // …so the same seed produces the exact same fired-event sequence, even
    // though `b` runs an extra chance-based law every year.
    expect(drive(a, 30)).toEqual(drive(b, 30));
    expect(a.rng()).toBe(b.rng());
    expect(Number(b.character.flags.world_ticks ?? 0)).toBeGreaterThan(0);
    expect(Number(a.character.flags.world_ticks ?? 0)).toBe(0);
  });
});

describe("law effect validation", () => {
  const forbidden: Effect[] = [
    { kind: "person", role: "friend" },
    { kind: "ailment", ailment: "flu" },
    { kind: "rel", delta: 5 },
    { kind: "relation", relation: "partner" },
    { kind: "memory", text: "A memory" },
  ];

  it.each(forbidden)("rejects $kind effects in flat and section laws", (effect) => {
    const law = { id: "unsafe", effects: [effect] };
    const flat = { ...worldPack(), laws: [law] };
    expect(eventPackSchema.safeParse(flat).success).toBe(false);
    const res = validatePack(flat);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join("\n")).toMatch(/RNG-free and subject-free/);
    expect(validatePackFile({
      ...worldPack(),
      sections: [{ id: "world", name: "World", laws: [law] }],
    }).ok).toBe(false);
  });

  it("supports every RNG-free, subject-free effect without advancing RNG", () => {
    const effects: WorldLawEffect[] = [
      { kind: "stat", stat: "smarts", delta: 1 },
      { kind: "money", delta: 10 },
      { kind: "trait", trait: "bookish", action: "add" },
      { kind: "flag", flag: "world", value: true },
      { kind: "unflag", flag: "old" },
      { kind: "counter", flag: "ticks", delta: 1 },
      { kind: "collect", flag: "savings" },
      { kind: "loseitem", item: "car" },
      { kind: "cure" },
      { kind: "die", cause: "world law" },
    ];
    const parsed = validatePack(worldPack([{ id: "safe", effects }]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const withLaw = new LifeSim([parsed.pack], { seed: 123 });
    const withoutLaw = life([], 123);
    applyWorldLaws(withLaw);
    expect(withLaw.rng()).toBe(withoutLaw.rng());
    expect(withLaw.character.alive).toBe(false);
    expect(withLaw.character.flags.world).toBe(true);
  });
});

describe("nested world laws", () => {
  const law = (id: string): WorldLaw => ({
    id,
    effects: [{ kind: "counter", flag: id, delta: 1 }],
  });
  const file: PackFile = {
    id: "world",
    name: "World",
    version: "1",
    laws: [law("top")],
    sections: [{ id: "era", name: "Era", laws: [law("scoped")] }],
  };

  it("loads law-only packs through both validation entry points", () => {
    const flat = validatePack({ id: "world", name: "World", version: "1", laws: file.laws });
    expect(flat.ok).toBe(true);
    if (flat.ok) {
      expect(flat.pack.events).toEqual([]);
      expect(eventPackSchema.safeParse(flat.pack).success).toBe(true);
    }
    const res = validatePackFile(file);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.loaded.pack.laws?.map((l) => l.id)).toEqual(["top", "scoped"]);
      expect(res.loaded.sections[0].lawIds).toEqual(["scoped"]);
    }
  });

  it("disabling a section prevents its laws from running, keeping top-level laws", () => {
    const res = validatePackFile(file);
    if (!res.ok) throw new Error(res.errors.join("\n"));
    const on = new LifeSim([effectivePack(res.loaded, new Set())], { seed: 1 });
    const off = new LifeSim([effectivePack(res.loaded, new Set([sectionKey("world", "era")]))], { seed: 1 });
    on.ageUp();
    off.ageUp();
    expect(on.character.flags).toMatchObject({ top: 1, scoped: 1 });
    expect(off.character.flags.top).toBe(1);
    expect(off.character.flags.scoped).toBeUndefined();
  });

  it("resolves bundled section laws before validation", () => {
    const manifest: PackFile = { ...file, sections: [{ id: "era", name: "Era", src: "era.json" }] };
    const resolved = resolveSectionSrcs(manifest, () => ({ laws: [law("scoped")] }));
    const res = validatePackFile(resolved);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.loaded.pack.laws).toHaveLength(2);
    expect(validatePackFile({
      ...manifest, sections: [{ ...manifest.sections![0], laws: [law("inline")] }],
    }).ok).toBe(false);
  });

  it("rejects duplicate law ids across sections and other content", () => {
    for (const id of ["top", "scoped", "only", "action", "item", "job"]) {
      const res = validatePackFile({
        ...worldPack([law("top")]),
        actions: [{ id: "action", title: "Action", result: "OK" }],
        items: [{ id: "item", name: "Item", price: 1 }],
        jobs: [{ id: "job", title: "Job", salary: 1 }],
        sections: [
          { id: "a", name: "A", laws: [law("scoped")] },
          { id: "b", name: "B", laws: [law(id)] },
        ],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors.join("\n")).toContain(`duplicate id "${id}"`);
    }
  });

  it("validates section laws for no-op and empty age windows", () => {
    for (const bad of [{ id: "noop" }, { ...law("age"), maxAge: 0 }]) {
      const res = validatePackFile({
        ...file, sections: [{ id: "era", name: "Era", laws: [bad] }],
      });
      expect(res.ok).toBe(false);
    }
  });
});

describe("world law death", () => {
  it("does not draw events or apply subsequent laws after a fatal law", () => {
    const sim = life([
      { id: "fatal", effects: [{ kind: "die", cause: "world" }] },
      { id: "after", effects: [{ kind: "money", delta: 10 }] },
    ], 1);
    sim.ageUp();
    expect(sim.character.alive).toBe(false);
    expect(sim.pending).toBeNull();
    expect(sim.character.money).toBe(0);
    expect(sim.log.filter((entry) => entry.kind === "death")).toHaveLength(1);
    applyWorldLaws(sim);
    expect(sim.character.money).toBe(0);
    expect(sim.log.filter((entry) => entry.kind === "death")).toHaveLength(1);
  });
});

describe("seeded noise", () => {
  it("is deterministic and unit-ranged", () => {
    const v = seededNoise(1, "law", "x", 5);
    expect(v).toBe(seededNoise(1, "law", "x", 5));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it("varies with each key part", () => {
    const v = seededNoise(1, "law", "a", 5);
    expect(seededNoise(2, "law", "a", 5)).not.toBe(v);
    expect(seededNoise(1, "law", "b", 5)).not.toBe(v);
    expect(seededNoise(1, "law", "a", 6)).not.toBe(v);
  });

  it("hashing is stable and order-sensitive", () => {
    expect(hashString("eralife")).toBe(hashString("eralife"));
    expect(hashString("eralife")).not.toBe(hashString("eralifE"));
  });
});

describe("life log", () => {
  it("logs a speaking law and honors silent", () => {
    const sim = life(
      [
        { id: "loud", title: "The cost of living rose.", effects: [{ kind: "money", delta: -1 }] },
        { id: "quiet", silent: true, effects: [{ kind: "money", delta: -1 }] },
      ],
      7,
    );
    sim.ageUp(); // first passive tick lands at age 1
    const texts = sim.log.map((l) => l.text);
    expect(texts.filter((t) => t === "The cost of living rose.")).toHaveLength(1);
  });
});
