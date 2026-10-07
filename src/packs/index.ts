import { validatePackFile } from "../engine/schema";
import {
  dependencyProblems,
  orderByDependencies,
  resolveSectionSrcs,
} from "../engine/packs";
import type { LoadedPack } from "../engine/types";

/**
 * Bundled-pack loader. Two shapes under src/packs/:
 *
 *   src/packs/<name>.json            → a flat (v1) pack file
 *   src/packs/<name>/pack.json       → a nested pack manifest whose sections
 *     may be inline or `{id, name, src: "section.json"}` pointing at sibling
 *     files in the same directory
 *
 * Unreferenced sibling files are ignored (a section file is not a pack on
 * its own). Every file is validated through the same zod + semantic rules as
 * user-imported packs; an invalid bundled pack throws at startup rather than
 * shipping silently — that is a build-time failure, not a runtime warning.
 */

const rawFiles = import.meta.glob("./*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;
const rawNested = import.meta.glob("./*/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/** The flattened core pack — convenience for tests and dev scripts. */
export function bundledCorePack() {
  const core = loadBundledPacks().find((p) => p.pack.id === "core");
  if (!core) throw new Error("bundled core pack not found");
  return core.pack;
}

export function loadBundledPacks(): LoadedPack[] {
  const packs: LoadedPack[] = [];

  // Nested manifests: ./<dir>/pack.json + sibling section files.
  const byDir = new Map<string, Record<string, unknown>>();
  for (const [path, data] of Object.entries(rawNested)) {
    const dir = path.split("/").slice(1, -1).join("/");
    const file = path.split("/").pop()!;
    (byDir.get(dir) ?? byDir.set(dir, {}).get(dir)!)[file] = data;
  }
  for (const [dir, files] of byDir) {
    const manifest = files["pack.json"];
    if (manifest === undefined) {
      throw new Error(
        `src/packs/${dir}/ contains JSON files but no pack.json manifest`,
      );
    }
    const resolved = resolveSectionSrcs(
      manifest as Parameters<typeof resolveSectionSrcs>[0],
      (src) => files[src.split("/").pop()!] as never,
    );
    const res = validatePackFile(resolved);
    if (!res.ok) {
      throw new Error(`bundled pack ${dir}/pack.json invalid:\n${res.errors.join("\n")}`);
    }
    packs.push(res.loaded);
  }

  // Flat packs at the top level.
  for (const [path, data] of Object.entries(rawFiles)) {
    const res = validatePackFile(data);
    if (!res.ok) {
      throw new Error(`bundled pack ${path} invalid:\n${res.errors.join("\n")}`);
    }
    packs.push(res.loaded);
  }

  // Bundled packs must form a satisfiable set: every `requires` resolves and
  // load order puts dependencies before the packs that declare them.
  const problems = dependencyProblems(packs.map((p) => p.pack));
  if (problems.length) {
    throw new Error(`bundled packs have unmet requirements:\n${problems.join("\n")}`);
  }
  const order = new Map(
    orderByDependencies(packs.map((p) => p.pack)).map((p, i) => [p.id, i]),
  );
  return packs.sort(
    (a, b) => (order.get(a.pack.id) ?? 0) - (order.get(b.pack.id) ?? 0),
  );
}
