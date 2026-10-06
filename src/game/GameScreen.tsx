import { useMemo, useRef, useState } from "react";
import { LifeSim } from "../engine/engine";
import { validatePackFile } from "../engine/schema";
import { sectionKey } from "../engine/packs";
import { STAT_KEYS, type EventPack, type LoadedPack } from "../engine/types";
import ActionsPanel from "./ActionsPanel";
import StatBar from "./StatBar";
import PeoplePanel from "./PeoplePanel";
import AilmentList from "./AilmentList";

interface Props {
  packs: EventPack[];
  bundledPacks: LoadedPack[];
  enabledPackIds: string[];
  onTogglePack: (id: string) => void;
  disabledSections: ReadonlySet<string>;
  onToggleSection: (key: string) => void;
  onImportPack: (pack: LoadedPack) => void;
}

export default function GameScreen({ packs, bundledPacks, enabledPackIds, onTogglePack, disabledSections, onToggleSection, onImportPack }: Props) {
  const [sim, setSim] = useState<LifeSim | null>(null);
  const [name, setName] = useState("Alex");
  const [seedText, setSeedText] = useState("");
  const [, forceRender] = useState(0);
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // Rebuild the sim only when a new life starts or the pack list changes.
  const packsRef = useRef(packs);
  packsRef.current = packs;

  const rerender = () => {
    forceRender((n) => n + 1);
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
  };

  const startLife = () => {
    const seed = seedText.trim()
      ? Number(seedText) || hashSeed(seedText)
      : undefined;
    setSim(new LifeSim(packsRef.current, { name: name.trim() || "Alex", seed }));
    setImportError("");
  };

  const importPackFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const res = validatePackFile(data);
      if (!res.ok) {
        setImportError(res.errors.join("\n"));
        return;
      }
      onImportPack(res.loaded);
      setImportError("");
    } catch (e) {
      setImportError(`Not valid JSON: ${(e as Error).message}`);
    }
  };

  const c = sim?.character;
  const pending = sim?.pending;

  return (
    <div className="game">
      <div className="panel">
        <h3>Character</h3>
        {c ? (
          <>
            <div className="char-name">{c.name}</div>
            <div className="char-age">
              Age {c.age}
              {c.alive ? "" : ` — died (${c.deathCause})`}
            </div>
            {STAT_KEYS.map((k) => (
              <StatBar key={k} name={k} value={c.stats[k]} />
            ))}
            <div className="money">${c.money.toLocaleString()}</div>
            {typeof c.flags.job === "string" && (
              <div className="char-job">{String(c.flags.job)}</div>
            )}
            {(Number(c.flags.savings ?? 0) > 0 || Number(c.flags.invested ?? 0) > 0) && (
              <div className="char-finance">
                {Number(c.flags.savings ?? 0) > 0 && (
                  <span>Savings ${Number(c.flags.savings).toLocaleString()}</span>
                )}
                {Number(c.flags.invested ?? 0) > 0 && (
                  <span>Invested ${Number(c.flags.invested).toLocaleString()}</span>
                )}
              </div>
            )}
            <div className="traits">
              {c.traits.map((t) => (
                <span key={t} className="trait-chip">{t}</span>
              ))}
              {Object.entries(c.flags)
                .filter(([, v]) => v === true)
                .map(([k]) => (
                  <span key={k} className="trait-chip">{k.replaceAll("_", " ")}</span>
                ))}
            </div>
            <AilmentList sim={sim!} onAct={rerender} />
            <div className="section-label">People</div>
            <PeoplePanel sim={sim!} onAct={rerender} />
          </>
        ) : (
          <p style={{ color: "var(--muted)" }}>No life yet. Start one below.</p>
        )}
        <div className="new-life">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <input
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            placeholder="Seed (opt.)"
            style={{ maxWidth: 90 }}
          />
        </div>
        <div className="new-life">
          <button className="btn primary" onClick={startLife} style={{ flex: 1 }}>
            New life
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Load pack…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => e.target.files?.[0] && importPackFile(e.target.files[0])}
          />
        </div>
        {importError && <div className="err">{importError}</div>}
      </div>

      <div className="center-col">
        <button
          className="age-btn"
          disabled={!sim || !c?.alive || !!pending}
          onClick={() => { sim?.ageUp(); rerender(); }}
        >
          {!sim ? "Start a new life" : !c?.alive ? "R.I.P." : pending ? "Choose first" : `Age up → ${c.age + 1}`}
        </button>
        {!c?.alive && sim && (
          <div className="dead-banner">
            {c?.name} died at {c?.age} of {c?.deathCause} with $
            {c?.money.toLocaleString()} to their name.
          </div>
        )}
        {pending && (
          <div className="event-card">
            <div className="event-cat">
              {pending.event.category ?? "life"}
              {pending.subject && (
                <span className="event-subject"> · {pending.subject.name}</span>
              )}
            </div>
            <div className="event-title">{pending.event.title}</div>
            <div className="event-desc">{pending.event.description}</div>
            {pending.choices.map((ch) => (
              <button
                key={ch.id}
                className="choice-btn"
                onClick={() => { sim?.resolve(ch.id); rerender(); }}
              >
                {ch.text}
              </button>
            ))}
          </div>
        )}
        {sim && <ActionsPanel sim={sim} onAct={rerender} />}
        <div className="panel" style={{ flex: 1 }}>
          <h3>Life log</h3>
          <div className="lifelog" ref={logRef}>
            {sim?.log.map((entry, i) => (
              <div key={i} className={`log-${entry.kind}`}>
                {entry.kind !== "year" && <span style={{ color: "var(--muted)" }}>[{entry.age}] </span>}
                {entry.text}
              </div>
            )) ?? <span style={{ color: "var(--muted)" }}>Your story will appear here.</span>}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Loaded packs</h3>
        {bundledPacks.map((lp) => {
          const p = lp.pack;
          const enabled = enabledPackIds.includes(p.id);
          return (
            <div key={p.id} className="cond-row">
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => onTogglePack(p.id)}
                />
                <b>{p.name}</b> <span style={{ color: "var(--muted)" }}>v{p.version}</span>
              </label>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {p.events.length} events
                {p.ailments?.length ? `, ${p.ailments.length} conditions` : ""}
              </div>
              {lp.sections.map((s) => {
                const key = sectionKey(p.id, s.id);
                return (
                  <label key={s.id} className="pack-section">
                    <input
                      type="checkbox"
                      checked={enabled && !disabledSections.has(key)}
                      disabled={!enabled}
                      onChange={() => onToggleSection(key)}
                    />
                    <span>{s.name}</span>
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>
                      {s.eventIds.length} ev{s.ailmentIds.length ? ` · ${s.ailmentIds.length} cond` : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          );
        })}
        {packs
          .filter((p) => !bundledPacks.some((b) => b.pack.id === p.id))
          .map((p) => (
            <div key={p.id} className="cond-row">
              <b>{p.name}</b> <span style={{ color: "var(--muted)" }}>v{p.version}</span>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {p.events.length} events (imported)
              </div>
            </div>
          ))}
        <PackSummary packs={packs} />
      </div>
    </div>
  );
}

function PackSummary({ packs }: { packs: EventPack[] }) {
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of packs)
      for (const e of p.events) m.set(e.category ?? "uncategorized", (m.get(e.category ?? "uncategorized") ?? 0) + 1);
    return [...m.entries()].sort();
  }, [packs]);
  return (
    <>
      <div className="section-label">Categories</div>
      {cats.map(([cat, n]) => (
        <div key={cat} style={{ fontSize: 13, color: "var(--muted)" }}>
          {cat} — {n}
        </div>
      ))}
    </>
  );
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
