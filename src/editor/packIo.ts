import type { Edge, Node } from "reactflow";
import type { EventPack, SimEvent } from "../engine/types";

export interface EventNodeData {
  event: SimEvent;
}

export function packToNodes(pack: EventPack): Node<EventNodeData>[] {
  return pack.events.map((ev, i) => ({
    id: ev.id,
    type: "eventNode",
    position: ev.ui ?? { x: (i % 4) * 260, y: Math.floor(i / 4) * 200 },
    data: { event: structuredClone(ev) },
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

/** Rebuild an EventPack from node data + current pack metadata. */
export function nodesToPack(
  nodes: Node<EventNodeData>[],
  meta: { id: string; name: string; version: string; description?: string },
): EventPack {
  return {
    ...meta,
    events: nodes.map((n) => ({
      ...n.data.event,
      ui: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
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
