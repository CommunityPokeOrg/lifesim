import { useCallback, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import type { DiseaseDef, EventPack, PackSectionInfo, SimEvent, WorldLaw } from "../engine/types";
import { validatePack, validatePackFile } from "../engine/schema";
import EventNode from "./EventNode";
import EventInspector from "./EventInspector";
import { downloadJson, nodesToPack, packToEdges, packToNodes, type EventNodeData } from "./packIo";

const nodeTypes = { eventNode: EventNode };

const EMPTY_PACK: EventPack = {
  id: "my_pack",
  name: "My Mod Pack",
  version: "1.0.0",
  events: [],
};

export default function EditorScreen({ onPlaytest }: { onPlaytest: (pack: EventPack) => void }) {
  const [meta, setMeta] = useState<Omit<EventPack, "events">>(EMPTY_PACK);
  const [nodes, setNodes, onNodesChange] = useNodesState<EventNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Nested-pack sections imported with the current pack (id -> display name). */
  const [sectionNames, setSectionNames] = useState<Map<string, string>>(new Map());
  /** Disease defs per imported section — kept for export round-trip. */
  const [sectionAilments, setSectionAilments] = useState<Map<string, DiseaseDef[]>>(new Map());
  const [sectionLaws, setSectionLaws] = useState<Map<string, WorldLaw[]>>(new Map());
  /** Target section for newly added events ("" = top-level events list). */
  const [newSection, setNewSection] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const eventIds = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const selected = nodes.find((n) => n.id === selectedId);

  /** Mutating a node's event data then re-syncing derived edges. */
  const mutateNode = useCallback(
    (id: string, fn: (ev: SimEvent) => SimEvent) => {
      setNodes((ns) => {
        const next = ns.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, event: fn(n.data.event) } } : n,
        );
        setEdges(packToEdges(next));
        return next;
      });
    },
    [setNodes, setEdges],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      // An edge from a choice handle writes that choice's `goto`.
      const choiceId = conn.sourceHandle?.startsWith("c:")
        ? conn.sourceHandle.slice(2)
        : null;
      if (!conn.source || !conn.target) return;
      if (choiceId) {
        mutateNode(conn.source, (ev) => ({
          ...ev,
          choices: ev.choices.map((ch) =>
            ch.id === choiceId ? { ...ch, goto: conn.target! } : ch,
          ),
        }));
        return;
      }
      setEdges((es) => addEdge(conn, es));
    },
    [mutateNode, setEdges],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) {
        const choiceId = e.sourceHandle?.startsWith("c:") ? e.sourceHandle.slice(2) : null;
        if (!choiceId) continue;
        mutateNode(e.source, (ev) => ({
          ...ev,
          choices: ev.choices.map((ch) => {
            if (ch.id !== choiceId) return ch;
            const nu = { ...ch };
            if (nu.goto === e.target) delete nu.goto;
            if (nu.outcomes) {
              nu.outcomes = nu.outcomes.map((o) =>
                o.goto === e.target ? { ...o, goto: undefined } : o,
              );
            }
            return nu;
          }),
        }));
      }
    },
    [mutateNode],
  );

  const addEvent = () => {
    const id = `event_${nodes.length + 1}`;
    const ev: SimEvent = {
      id,
      title: "New event",
      description: "Describe what happens.",
      weight: 10,
      choices: [{ id: "ok", text: "OK", result: "Life goes on." }],
    };
    const node: Node<EventNodeData> = {
      id,
      type: "eventNode",
      position: { x: 80 + nodes.length * 30, y: 80 + nodes.length * 30 },
      data: { event: ev, sectionId: newSection || undefined },
    };
    setNodes((ns) => [...ns, node]);
    setSelectedId(id);
    setSheetOpen(true);
  };

  const importPack = async (file: File) => {
    try {
      const res = validatePackFile(JSON.parse(await file.text()));
      if (!res.ok) {
        setStatus({ ok: false, text: res.errors.join("\n") });
        return;
      }
      const { events: _events, ...rest } = res.loaded.pack; // keep actions/items/jobs
      setMeta(rest);
      setSectionNames(new Map(res.loaded.sections.map((s: PackSectionInfo) => [s.id, s.name])));
      setSectionAilments(
        new Map(res.loaded.sections.map((s: PackSectionInfo) => [
          s.id,
          (s.ailmentIds ?? [])
            .map((id) => res.loaded.pack.ailments?.find((a) => a.id === id))
            .filter((a): a is NonNullable<typeof a> => a !== undefined),
        ])),
      );
      setSectionLaws(new Map(res.loaded.sections.map((s) => [
        s.id,
        (res.loaded.pack.laws ?? []).filter((law) => s.lawIds.includes(law.id)),
      ])));
      setNewSection(res.loaded.sections[0]?.id ?? "");
      const ailBySection = new Map<string, DiseaseDef[]>();
      const allAilments = res.loaded.pack.ailments ?? [];
      for (const s of res.loaded.sections) {
        ailBySection.set(
          s.id,
          allAilments.filter((a) => s.ailmentIds.includes(a.id)),
        );
      }
      const inSection = new Set(res.loaded.sections.flatMap((s) => s.ailmentIds));
      ailBySection.set("", allAilments.filter((a) => !inSection.has(a.id)));
      setSectionAilments(ailBySection);
      const ns = packToNodes(res.loaded.pack, res.loaded.sections);
      setNodes(ns);
      setEdges(packToEdges(ns));
      setSelectedId(null);
      const secs = res.loaded.sections.length
        ? ` across ${res.loaded.sections.length} sections`
        : "";
      setStatus({ ok: true, text: `Imported "${res.loaded.pack.name}" (${res.loaded.pack.events.length} events${secs}).` });
    } catch (e) {
      setStatus({ ok: false, text: `Not valid JSON: ${(e as Error).message}` });
    }
  };

  /** Raw file shape (sections preserved) — for export. */
  const buildPackFile = () =>
    nodesToPack(nodes, meta, sectionNames, sectionAilments, sectionLaws);

  /** Flattened pack — for validation/playtest (what the engine consumes). */
  const buildPack = (): EventPack => {
    const file = buildPackFile();
    const res = validatePackFile(file);
    return res.ok ? res.loaded.pack : (file as EventPack);
  };

  const exportPack = () => {
    const file = buildPackFile();
    const res = validatePackFile(file);
    if (!res.ok) {
      setStatus({ ok: false, text: res.errors.join("\n") });
      return;
    }
    downloadJson(`${file.id}.json`, file);
    setStatus({ ok: true, text: `Exported ${file.id}.json` });
  };

  const validate = () => {
    const res = validatePack(buildPack());
    setStatus(res.ok ? { ok: true, text: "Pack is valid." } : { ok: false, text: res.errors.join("\n") });
  };

  const playtest = () => {
    const res = validatePack(buildPack());
    if (!res.ok) {
      setStatus({ ok: false, text: res.errors.join("\n") });
      return;
    }
    onPlaytest(res.pack);
  };

  return (
    <div className="editor">
      <div className="editor-canvas">
        <div className="editor-toolbar">
          <button className="btn" onClick={addEvent}>+ Event</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <button className="btn" onClick={exportPack}>Export JSON</button>
          <button className="btn" onClick={validate}>Validate</button>
          <button className="btn primary" onClick={playtest}>Playtest ▶</button>
          <button
            className="btn inspector-toggle"
            onClick={() => setSheetOpen((o) => !o)}
          >
            {sheetOpen ? "Hide panel" : "Panel"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => e.target.files?.[0] && importPack(e.target.files[0])}
          />
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onNodeClick={(_, n) => { setSelectedId(n.id); setSheetOpen(true); }}
          onPaneClick={() => { setSelectedId(null); setSheetOpen(false); }}
          onNodeDragStop={(_, n) =>
            mutateNode(n.id, (ev) => ({ ...ev, ui: { x: Math.round(n.position.x), y: Math.round(n.position.y) } }))
          }
          deleteKeyCode={["Backspace", "Delete"]}
          minZoom={0.15}
          panOnDrag
          zoomOnPinch
          fitView
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        {status && !sheetOpen && (
          <div className={`editor-status ${status.ok ? "ok" : "err"}`}>{status.text}</div>
        )}
      </div>
      <aside className={sheetOpen ? "inspector-sheet open" : "inspector-sheet"}>
        <button
          className="sheet-handle"
          aria-label="Toggle inspector panel"
          onClick={() => setSheetOpen((o) => !o)}
        >
          <span className="sheet-grip" />
        </button>
        {selected ? (
          <EventInspector
            event={selected.data.event}
            eventIds={eventIds}
            onChange={(ev) => mutateNode(selected.id, () => ev)}
            onDelete={() => {
              setNodes((ns) => {
                const next = ns.filter((n) => n.id !== selected.id);
                setEdges(packToEdges(next));
                return next;
              });
              setSelectedId(null);
            }}
          />
        ) : (
          <div className="inspector">
            <h3>Pack</h3>
            <div className="field"><label>id</label>
              <input type="text" value={meta.id} onChange={(e) => setMeta({ ...meta, id: e.target.value })} /></div>
            <div className="field"><label>name</label>
              <input type="text" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></div>
            <div className="field"><label>version</label>
              <input type="text" value={meta.version} onChange={(e) => setMeta({ ...meta, version: e.target.value })} /></div>
            <div className="field"><label>description</label>
              <textarea rows={3} value={meta.description ?? ""} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></div>
            {sectionNames.size > 0 && (
              <div className="field"><label>new events go to section</label>
                <select value={newSection} onChange={(e) => setNewSection(e.target.value)}>
                  <option value="">(top level)</option>
                  {[...sectionNames.entries()].map(([sid, sname]) => (
                    <option key={sid} value={sid}>{sname}</option>
                  ))}
                </select>
              </div>
            )}
            <p style={{ color: "var(--muted)", fontSize: 12 }}>
              Tap a node to edit it. Drag from a choice handle (right side) to
              another node to create a <code>goto</code> chain. Select an edge and
              press Delete to remove it.
            </p>
          </div>
        )}
        {status && sheetOpen && (
          <div className={`inspector-status ${status.ok ? "ok" : "err"}`}>{status.text}</div>
        )}
      </aside>
    </div>
  );
}
