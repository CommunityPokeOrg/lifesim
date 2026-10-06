import type { EventPack } from "../engine/types";

/**
 * All bundled packs under src/packs/*.json, auto-loaded so dropping a new
 * pack file into this directory needs no code changes.
 */
const modules = import.meta.glob("./*.json", { eager: true });

export const BUILTIN_PACKS: EventPack[] = Object.values(modules).map(
  (m) => (m as { default: EventPack }).default,
);
