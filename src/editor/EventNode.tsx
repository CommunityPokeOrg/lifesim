import { Handle, Position, type NodeProps } from "reactflow";
import type { EventNodeData } from "./packIo";

/**
 * One node = one event. Left handle receives `goto` links; each choice gets
 * its own source handle on the right so an edge reads as "this choice leads
 * to that event".
 */
export default function EventNode({ data, selected }: NodeProps<EventNodeData>) {
  const ev = data.event;
  return (
    <div className={selected ? "event-node selected" : "event-node"}>
      <Handle type="target" position={Position.Left} />
      <div className="node-cat">{data.sectionId ? `${data.sectionId} / ` : ""}{ev.category ?? "event"} · w={ev.weight ?? 10}{ev.once ? " · once" : ""}{ev.cooldown ? ` · cd${ev.cooldown}` : ""}{ev.forced ? " · forced" : ""}</div>
      <div className="node-title">{ev.title}</div>
      {ev.choices.map((ch, i) => (
        <div key={ch.id} className="node-choice" style={{ position: "relative" }}>
          → {ch.text}
          <Handle
            type="source"
            position={Position.Right}
            id={`c:${ch.id}`}
            style={{ top: "auto", right: -14 }}
          />
          <span style={{ display: "none" }}>{i}</span>
        </div>
      ))}
    </div>
  );
}
