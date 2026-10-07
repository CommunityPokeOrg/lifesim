import type {
  EventPack,
  LoadedPack,
  PackFile,
  PackRequirement,
  PackSection,
  PackSectionInfo,
} from "./types";

/**
 * Nested pack model: a pack file may inline `events` (v1 flat format) and/or
 * declare named `sections`, each with its own events and disease defs. The
 * loader flattens sections into the EventPack the engine consumes while
 * keeping a section map for the enable/disable UI.
 *
 * `sectionKey` identifies a section for toggling: "packId:sectionId".
 */

export const sectionKey = (packId: string, sectionId: string) => `${packId}:${sectionId}`;

/** Flatten a validated pack file into an EventPack + section map. */
export function flattenPack(file: PackFile): LoadedPack {
  const events = [...(file.events ?? [])];
  const ailments = [...(file.ailments ?? [])];
  const laws = [...(file.laws ?? [])];
  const sections: PackSectionInfo[] = [];
  for (const s of file.sections ?? []) {
    const secEvents = s.events ?? [];
    const secAilments = s.ailments ?? [];
    const secLaws = s.laws ?? [];
    sections.push({
      id: s.id,
      name: s.name,
      eventIds: secEvents.map((e) => e.id),
      ailmentIds: secAilments.map((a) => a.id),
      lawIds: secLaws.map((law) => law.id),
    });
    events.push(...secEvents);
    ailments.push(...secAilments);
    laws.push(...secLaws);
  }
  return {
    pack: {
      id: file.id,
      name: file.name,
      version: file.version,
      description: file.description,
      requires: file.requires,
      events,
      ailments: ailments.length ? ailments : undefined,
      actions: file.actions,
      items: file.items,
      jobs: file.jobs,
      names: file.names,
      laws: laws.length ? laws : undefined,
    },
    sections,
  };
}

/**
 * Produce the engine-facing EventPack with disabled sections filtered out.
 * `disabled` holds sectionKeys ("packId:sectionId").
 */
export function effectivePack(loaded: LoadedPack, disabled: ReadonlySet<string>): EventPack {
  const packId = loaded.pack.id;
  const off = loaded.sections.filter((s) => disabled.has(sectionKey(packId, s.id)));
  if (!off.length) return loaded.pack;
  const offEvents = new Set(off.flatMap((s) => s.eventIds));
  const offLaws = new Set(off.flatMap((s) => s.lawIds));
  const laws = loaded.pack.laws?.filter((law) => !offLaws.has(law.id));
  const offAilments = new Set(off.flatMap((s) => s.ailmentIds));
  const ailments = loaded.pack.ailments?.filter((a) => !offAilments.has(a.id));
  return {
    ...loaded.pack,
    events: loaded.pack.events.filter((e) => !offEvents.has(e.id)),
    ailments: ailments?.length ? ailments : undefined,
    laws: laws?.length ? laws : undefined,
  };
}

/**
 * Resolve `src` references in a manifest's sections. `resolve` receives the
 * src string and returns the parsed sibling file (a PackSection-shaped blob).
 * Used by the bundled-pack loader; imported packs can't use `src`.
 */
export function resolveSectionSrcs(
  file: PackFile,
  resolve: (src: string) => Partial<PackSection> | undefined,
): PackFile {
  if (!file.sections?.some((s) => s.src)) return file;
  return {
    ...file,
    sections: file.sections.map((s) => {
      if (!s.src) return s;
      const resolved = resolve(s.src);
      return { ...s, ...resolved, id: s.id, name: s.name ?? resolved?.name ?? s.id, src: undefined };
    }),
  };
}

/** All events in a pack file across the top level and every section. */
export function allEvents(file: PackFile) {
  return [...(file.events ?? []), ...(file.sections ?? []).flatMap((s) => s.events ?? [])];
}

/* --------------------------- pack dependencies --------------------------- */

/** Anything with an id/version and optional requirements can be checked. */
export type PackRef = Pick<EventPack, "id" | "version"> & {
  requires?: PackRequirement[];
};

const parseVersion = (v: string) => {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim());
  return m
    ? ([Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] as const)
    : null;
};

/** Compare two semver-ish versions: negative a<b, 0 equal, positive a>b. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return a === b ? 0 : a < b ? -1 : 1;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * Whether `version` satisfies a requirement range. Supported forms:
 *   "1.2.3" | "=1.2.3"  — exact match
 *   ">=1.2" ">1.2" "<=1.2" "<1.2" — ordered comparison
 *   "^1.2.3" — compatible: >=1.2.3 and <2.0.0 (0.x pins minor/patch like npm)
 *   "~1.2.3" — same minor: >=1.2.3 and <1.3.0
 */
export function satisfiesVersion(version: string, range: string): boolean {
  const r = range.trim();
  const m = /^(>=|<=|==|=|>|<|\^|~)?\s*(.+)$/.exec(r);
  const op = m?.[1] ?? "=";
  const target = (m?.[2] ?? "").trim();
  const cmp = compareVersions(version, target);
  const bound = parseVersion(target);
  switch (op) {
    case ">=": return cmp >= 0;
    case "<=": return cmp <= 0;
    case ">":  return cmp > 0;
    case "<":  return cmp < 0;
    case "^": {
      if (cmp < 0 || !bound) return false;
      const v = parseVersion(version)!;
      if (bound[0] > 0) return v[0] === bound[0];
      if (bound[1] > 0) return v[0] === 0 && v[1] === bound[1];
      return v[0] === 0 && v[1] === 0 && v[2] === bound[2];
    }
    case "~": {
      if (cmp < 0 || !bound) return false;
      const v = parseVersion(version)!;
      return v[0] === bound[0] && v[1] === bound[1];
    }
    default: return cmp === 0;
  }
}

/**
 * Human-readable problems with a set of packs' `requires` declarations:
 * missing packs, version mismatches, and dependency cycles. An empty result
 * means every declared requirement is satisfiable inside the set.
 */
export function dependencyProblems(packs: readonly PackRef[]): string[] {
  const byId = new Map(packs.map((p) => [p.id, p]));
  const problems: string[] = [];
  for (const p of packs) {
    for (const req of p.requires ?? []) {
      const dep = byId.get(req.pack);
      if (!dep) {
        problems.push(`pack "${p.id}" requires "${req.pack}", which is not loaded`);
      } else if (req.version && !satisfiesVersion(dep.version, req.version)) {
        problems.push(
          `pack "${p.id}" requires "${req.pack}" ${req.version}, but v${dep.version} is loaded`,
        );
      }
    }
  }
  // Cycles: walk each pack's requires within the set.
  for (const start of packs) {
    const seen = new Set<string>();
    const stack = [start.id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === start.id && seen.size) {
        problems.push(`circular pack dependency involving "${start.id}"`);
        break;
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      const node = byId.get(cur);
      for (const req of node?.requires ?? []) {
        if (byId.has(req.pack)) stack.push(req.pack);
      }
    }
  }
  return [...new Set(problems)];
}

/**
 * Order packs so every pack follows the packs it requires (dependencies load
 * first). Requirements pointing outside the set are ignored — report them
 * with `dependencyProblems`. Stable within these constraints, and cycles
 * degrade to the packs' original relative order.
 */
export function orderByDependencies<T extends PackRef>(packs: readonly T[]): T[] {
  const ids = new Set(packs.map((p) => p.id));
  const remaining = packs.map((p, i) => ({ p, i }));
  const loaded = new Set<string>();
  const out: T[] = [];
  // Round-robin: emit packs whose in-set requirements are already emitted.
  while (remaining.length) {
    let progressed = false;
    for (let k = 0; k < remaining.length; k++) {
      const { p } = remaining[k];
      const ready = (p.requires ?? []).every((r) => !ids.has(r.pack) || loaded.has(r.pack));
      if (!ready) continue;
      out.push(p);
      loaded.add(p.id);
      remaining.splice(k, 1);
      progressed = true;
      break;
    }
    if (!progressed) {
      // Cycle or unresolvable order — keep the survivors in input order.
      out.push(...remaining.map((r) => r.p));
      break;
    }
  }
  return out;
}
