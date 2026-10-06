import type {
  EventPack,
  LoadedPack,
  PackFile,
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
  const sections: PackSectionInfo[] = [];
  for (const s of file.sections ?? []) {
    const secEvents = s.events ?? [];
    const secAilments = s.ailments ?? [];
    sections.push({
      id: s.id,
      name: s.name,
      eventIds: secEvents.map((e) => e.id),
      ailmentIds: secAilments.map((a) => a.id),
    });
    events.push(...secEvents);
    ailments.push(...secAilments);
  }
  return {
    pack: {
      id: file.id,
      name: file.name,
      version: file.version,
      description: file.description,
      events,
      ailments: ailments.length ? ailments : undefined,
      actions: file.actions,
      items: file.items,
      jobs: file.jobs,
      names: file.names,
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
  const offAilments = new Set(off.flatMap((s) => s.ailmentIds));
  const ailments = loaded.pack.ailments?.filter((a) => !offAilments.has(a.id));
  return {
    ...loaded.pack,
    events: loaded.pack.events.filter((e) => !offEvents.has(e.id)),
    ailments: ailments?.length ? ailments : undefined,
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
