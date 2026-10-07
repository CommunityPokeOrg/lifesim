import type { Edge, Node } from "reactflow";
import type {
  DiseaseDef,
  EventPack,
  PackFile,
  PackSectionInfo,
  SimEvent,
  WorldLaw,
} from "../engine/types";

export interface EventNodeData {
  event: SimEvent;
  /** Which pack section this event came from (nested packs only). */
  sectionId?: string;
}

/**
 * When `sections` is given (a nested pack was imported), each node records
 * which subsection its event belongs to so export can regroup faithfully.
 */
export function packToNodes(
  pack: EventPack,
  sections?: PackSectionInfo[],
): Node<EventNodeData>[] {
  const sectionOf = new Map<string, string>();
  for (const s of sections ?? []) {
    for (const eid of s.eventIds) sectionOf.set(eid, s.id);
  }
  return pack.events.map((ev, i) => ({
    id: ev.id,
    type: "eventNode",
    position: ev.ui ?? { x: (i % 4) * 260, y: Math.floor(i / 4) * 200 },
    data: { event: structuredClone(ev), sectionId: sectionOf.get(ev.id) },
  }));
}

/** Edges visualize `goto` chains: choice-level gotos and outcome-level gotos. */
export function packToEdges(nodes: Node<EventNodeData>[]): Edge[] {
  const edges: Edge[] = [];
  for (const n of nodes) {
    const ev = n.data.event;
    for (const ch of ev.choices) {
      const targets = new Set<string>();
      if (ch.outcomes?.length) {
        for (const o of ch.outcomes) if (o.goto) targets.add(o.goto);
        if (ch.goto) targets.add(ch.goto);
      } else if (ch.goto) {
        targets.add(ch.goto);
      }
      for (const target of targets) {
        edges.push({
          id: `${ev.id}:${ch.id}->${target}`,
          source: ev.id,
          sourceHandle: `c:${ch.id}`,
          target,
          label: ch.id,
          animated: true,
        });
      }
    }
  }
  return edges;
}

/**
 * Rebuild a pack file from node data + current pack metadata. Nodes carrying
 * a `sectionId` are regrouped into `sections` (nested pack preserved across
 * the round-trip); sectionless nodes stay as top-level `events`.
 * `sectionAilments` maps section id -> disease defs so sections holding only
 * ailments (no event nodes) survive the round-trip too.
 */
export function nodesToPack(
  nodes: Node<EventNodeData>[],
  meta: Omit<EventPack, "events">,
  sectionNames?: Map<string, string>,
  /** Section id → disease defs imported with the pack.
   *  The graph only carries events, so ailments pass through untouched. */
  sectionAilments?: Map<string, DiseaseDef[]>,
  /** Section laws pass through unchanged, retaining their toggle scope. */
  sectionLaws?: Map<string, WorldLaw[]>,
): PackFile {
  const eventOf = (n: Node<EventNodeData>) => ({
    ...n.data.event,
    ui: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
  });

  const sectionOrder: string[] = [];
  const bySection = new Map<string, SimEvent[]>();
  const loose: SimEvent[] = [];
  for (const n of nodes) {
    const sid = n.data.sectionId;
    if (!sid) {
      loose.push(eventOf(n));
      continue;
    }
    if (!bySection.has(sid)) {
      bySection.set(sid, []);
      sectionOrder.push(sid);
    }
    bySection.get(sid)!.push(eventOf(n));
  }
  // Sections that carry only ailments or laws (no events) still round-trip.
  for (const sid of [...(sectionAilments?.keys() ?? []), ...(sectionLaws?.keys() ?? [])]) {
    if (sid && !sectionOrder.includes(sid)) sectionOrder.push(sid);
  }
  const lawIdsInSections = new Set(
    [...(sectionLaws?.entries() ?? [])].filter(([sid]) => sid).flatMap(([, laws]) => laws.map((law) => law.id)),
  );
  const looseLaws = meta.laws?.filter((law) => !lawIdsInSections.has(law.id));
  const inSections = new Set(
    [...(sectionAilments?.values() ?? [])].flat().map((d) => d.id),
  );
  const looseAilments = (meta.ailments ?? []).filter(
    (d) => !inSections.has(d.id),
  );
  const base: PackFile = {
    ...meta,
    laws: looseLaws?.length ? looseLaws : undefined,
    ailments: looseAilments.length ? looseAilments : undefined,
  };
  if (sectionOrder.length === 0) {
    return { ...base, events: nodes.map(eventOf) };
  }
  return {
    ...base,
    events: loose.length ? loose : undefined,
    sections: sectionOrder.map((sid) => ({
      id: sid,
      name: sectionNames?.get(sid) ?? sid,
      events: bySection.get(sid),
      laws: sectionLaws?.get(sid)?.length ? sectionLaws.get(sid) : undefined,
      ailments: sectionAilments?.get(sid)?.length
        ? sectionAilments.get(sid)
        : undefined,
    })),
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
