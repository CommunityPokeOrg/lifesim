import type { Condition, Effect, Outcome, SimEvent } from "../engine/types";
import { STAT_KEYS } from "../engine/types";

interface Props {
  event: SimEvent;
  eventIds: string[];
  onChange: (ev: SimEvent) => void;
  onDelete: () => void;
}

const OPS = ["gte", "lte", "gt", "lt", "eq", "neq"] as const;

/** Edit one SimEvent. Covers the common structured fields; a condition root
 *  that isn't `all`/a leaf is shown as raw JSON so nothing is lost. */
export default function EventInspector({ event, eventIds, onChange, onDelete }: Props) {
  const set = <K extends keyof SimEvent>(k: K, v: SimEvent[K]) =>
    onChange({ ...event, [k]: v });

  const flat = flattenConditions(event.conditions);

  return (
    <div className="inspector">
      <h3>Event: {event.id}</h3>
      <button className="btn mini danger" onClick={onDelete} style={{ marginBottom: 12 }}>
        Delete event
      </button>

      <div className="field">
        <label>Title</label>
        <input type="text" value={event.title} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea rows={3} value={event.description} onChange={(e) => set("description", e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Category</label>
          <input type="text" value={event.category ?? ""} onChange={(e) => set("category", e.target.value || undefined)} />
        </div>
        <div className="field">
          <label>Base weight</label>
          <input
            type="number"
            value={event.weight ?? 10}
            onChange={(e) => set("weight", Number(e.target.value))}
          />
        </div>
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={event.once ?? false}
            onChange={(e) => set("once", e.target.checked || undefined)}
          />{" "}
          Fire once per life
        </label>
      </div>

      <div className="section-label">Conditions (all must pass)</div>
      {flat.complex ? (
        <ConditionJson value={event.conditions} onChange={(c) => set("conditions", c)} />
      ) : (
        <>
          {flat.list.map((cond, i) => (
            <ConditionRow
              key={i}
              cond={cond}
              eventIds={eventIds}
              onChange={(c) => {
                const list = flat.list.slice();
                list[i] = c;
                set("conditions", unflattenConditions(list));
              }}
              onRemove={() => {
                const list = flat.list.slice();
                list.splice(i, 1);
                set("conditions", unflattenConditions(list));
              }}
            />
          ))}
          <button
            className="btn mini"
            onClick={() =>
              set("conditions", unflattenConditions([...flat.list, { kind: "age", min: 0 }]))
            }
          >
            + condition
          </button>
        </>
      )}

      <div className="section-label">Choices</div>
      {event.choices.map((ch, i) => (
        <ChoiceEditor
          key={i}
          choice={ch}
          eventIds={eventIds}
          onChange={(c) => {
            const choices = event.choices.slice();
            choices[i] = c;
            set("choices", choices);
          }}
          onRemove={() => set("choices", event.choices.filter((_, j) => j !== i))}
        />
      ))}
      <button
        className="btn mini"
        onClick={() =>
          set("choices", [
            ...event.choices,
            { id: `choice_${event.choices.length + 1}`, text: "New choice", result: "…" },
          ])
        }
      >
        + choice
      </button>
    </div>
  );
}

/* ------------------------------- conditions ------------------------------- */

function flattenConditions(cond: Condition | undefined): { list: Condition[]; complex: boolean } {
  if (!cond) return { list: [], complex: false };
  if (cond.kind === "all") {
    const allFlat = cond.conditions.every((c) => c.kind !== "all" && c.kind !== "any" && c.kind !== "not");
    if (allFlat) return { list: cond.conditions, complex: false };
    return { list: [], complex: true };
  }
  if (cond.kind === "any" || cond.kind === "not") return { list: [], complex: true };
  return { list: [cond], complex: false };
}

function unflattenConditions(list: Condition[]): Condition | undefined {
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  return { kind: "all", conditions: list };
}

function ConditionJson({ value, onChange }: { value: Condition | undefined; onChange: (c: Condition | undefined) => void }) {
  return (
    <div className="field">
      <label>Compound condition (JSON)</label>
      <textarea
        rows={6}
        defaultValue={JSON.stringify(value, null, 2)}
        onBlur={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            /* keep last valid value */
          }
        }}
      />
    </div>
  );
}

function ConditionRow({
  cond,
  eventIds,
  onChange,
  onRemove,
}: {
  cond: Condition;
  eventIds: string[];
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const leafKinds = ["age", "stat", "money", "trait", "flag", "chose"] as const;
  const kind = leafKinds.includes(cond.kind as never) ? cond.kind : "age";
  return (
    <div className="cond-row">
      <div className="field-row">
        <div className="field">
          <select
            value={kind}
            onChange={(e) => onChange(defaultCondition(e.target.value))}
          >
            {leafKinds.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <button className="btn mini danger" onClick={onRemove}>×</button>
      </div>
      <CondFields cond={cond} eventIds={eventIds} onChange={onChange} />
    </div>
  );
}

function defaultCondition(kind: string): Condition {
  switch (kind) {
    case "stat": return { kind: "stat", stat: "smarts", op: "gte", value: 50 };
    case "money": return { kind: "money", op: "gte", value: 0 };
    case "trait": return { kind: "trait", trait: "lucky" };
    case "flag": return { kind: "flag", flag: "flag_name", equals: true };
    case "chose": return { kind: "chose", event: "event_id", choice: "choice_id" };
    default: return { kind: "age", min: 0 };
  }
}

function CondFields({ cond, eventIds, onChange }: { cond: Condition; eventIds: string[]; onChange: (c: Condition) => void }) {
  switch (cond.kind) {
    case "age":
      return (
        <div className="field-row">
          <div className="field"><label>min</label>
            <input type="number" value={cond.min ?? ""} onChange={(e) => onChange({ ...cond, min: e.target.value === "" ? undefined : Number(e.target.value) })} /></div>
          <div className="field"><label>max</label>
            <input type="number" value={cond.max ?? ""} onChange={(e) => onChange({ ...cond, max: e.target.value === "" ? undefined : Number(e.target.value) })} /></div>
        </div>
      );
    case "stat":
      return (
        <div className="field-row">
          <div className="field">
            <select value={cond.stat} onChange={(e) => onChange({ ...cond, stat: e.target.value as typeof cond.stat })}>
              {STAT_KEYS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <select value={cond.op ?? "gte"} onChange={(e) => onChange({ ...cond, op: e.target.value as typeof cond.op })}>
              {OPS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="field">
            <input type="number" value={cond.value} onChange={(e) => onChange({ ...cond, value: Number(e.target.value) })} />
          </div>
        </div>
      );
    case "money":
      return (
        <div className="field-row">
          <div className="field">
            <select value={cond.op ?? "gte"} onChange={(e) => onChange({ ...cond, op: e.target.value as typeof cond.op })}>
              {OPS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="field">
            <input type="number" value={cond.value} onChange={(e) => onChange({ ...cond, value: Number(e.target.value) })} />
          </div>
        </div>
      );
    case "trait":
      return (
        <div className="field">
          <input type="text" value={cond.trait} onChange={(e) => onChange({ ...cond, trait: e.target.value })} placeholder="trait name" />
        </div>
      );
    case "flag":
      return (
        <div className="field-row">
          <div className="field">
            <input type="text" value={cond.flag} onChange={(e) => onChange({ ...cond, flag: e.target.value })} placeholder="flag" />
          </div>
          <div className="field">
            <input
              type="text"
              value={cond.equals === undefined ? "(set)" : JSON.stringify(cond.equals)}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ ...cond, equals: v === "(set)" || v === "" ? undefined : parseLiteral(v) });
              }}
              placeholder="equals value"
            />
          </div>
        </div>
      );
    case "chose":
      return (
        <div className="field-row">
          <div className="field">
            <select value={cond.event} onChange={(e) => onChange({ ...cond, event: e.target.value })}>
              {!eventIds.includes(cond.event) && <option>{cond.event}</option>}
              {eventIds.map((id) => <option key={id}>{id}</option>)}
            </select>
          </div>
          <div className="field">
            <input type="text" value={cond.choice} onChange={(e) => onChange({ ...cond, choice: e.target.value })} placeholder="choice id" />
          </div>
        </div>
      );
    default:
      return null;
  }
}

function parseLiteral(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

/* --------------------------------- choices -------------------------------- */

function ChoiceEditor({
  choice,
  eventIds,
  onChange,
  onRemove,
}: {
  choice: SimEvent["choices"][number];
  eventIds: string[];
  onChange: (c: SimEvent["choices"][number]) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<typeof choice>) => onChange({ ...choice, ...patch });
  const branched = !!choice.outcomes;
  return (
    <div className="choice-box">
      <div className="field-row">
        <div className="field"><label>id</label>
          <input type="text" value={choice.id} onChange={(e) => set({ id: e.target.value })} /></div>
        <button className="btn mini danger" onClick={onRemove}>×</button>
      </div>
      <div className="field"><label>button text</label>
        <input type="text" value={choice.text} onChange={(e) => set({ text: e.target.value })} /></div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={branched}
            onChange={(e) =>
              e.target.checked
                ? set({ outcomes: [{ weight: 50, result: choice.result ?? "…", effects: choice.effects }], effects: undefined, result: undefined })
                : set({ outcomes: undefined, result: choice.outcomes?.[0]?.result ?? "…", effects: choice.outcomes?.[0]?.effects })
            }
          />{" "}
          random branches
        </label>
      </div>
      {branched ? (
        choice.outcomes!.map((o, i) => (
          <OutcomeEditor
            key={i}
            outcome={o}
            eventIds={eventIds}
            onChange={(nu) => {
              const outcomes = choice.outcomes!.slice();
              outcomes[i] = nu;
              set({ outcomes });
            }}
            onRemove={() => set({ outcomes: choice.outcomes!.filter((_, j) => j !== i) })}
          />
        ))
      ) : (
        <>
          <div className="field"><label>result text</label>
            <textarea rows={2} value={choice.result ?? ""} onChange={(e) => set({ result: e.target.value })} /></div>
          <EffectsEditor effects={choice.effects ?? []} onChange={(effects) => set({ effects })} />
        </>
      )}
      {branched && (
        <button
          className="btn mini"
          onClick={() => set({ outcomes: [...choice.outcomes!, { weight: 50, result: "…" }] })}
        >
          + branch
        </button>
      )}
      <GotoSelect value={choice.goto} eventIds={eventIds} onChange={(g) => set({ goto: g })} />
    </div>
  );
}

function OutcomeEditor({
  outcome, eventIds, onChange, onRemove,
}: { outcome: Outcome; eventIds: string[]; onChange: (o: Outcome) => void; onRemove: () => void }) {
  const set = (patch: Partial<Outcome>) => onChange({ ...outcome, ...patch });
  return (
    <div className="outcome-box">
      <div className="field-row">
        <div className="field"><label>weight</label>
          <input type="number" value={outcome.weight} onChange={(e) => set({ weight: Number(e.target.value) })} /></div>
        <button className="btn mini danger" onClick={onRemove}>×</button>
      </div>
      <div className="field"><label>result</label>
        <textarea rows={2} value={outcome.result} onChange={(e) => set({ result: e.target.value })} /></div>
      <EffectsEditor effects={outcome.effects ?? []} onChange={(effects) => set({ effects })} />
      <GotoSelect value={outcome.goto} eventIds={eventIds} onChange={(g) => set({ goto: g })} label="branch goto" />
    </div>
  );
}

function GotoSelect({ value, eventIds, onChange, label }: { value: string | undefined; eventIds: string[]; onChange: (g: string | undefined) => void; label?: string }) {
  return (
    <div className="field">
      <label>{label ?? "goto event (edge)"}</label>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">(none)</option>
        {value && !eventIds.includes(value) && <option value={value}>{value} (missing)</option>}
        {eventIds.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
    </div>
  );
}

/* --------------------------------- effects -------------------------------- */

const EFFECT_KINDS = ["stat", "money", "trait", "flag", "unflag", "die"] as const;

function EffectsEditor({ effects, onChange }: { effects: Effect[]; onChange: (e: Effect[]) => void }) {
  return (
    <div>
      {effects.map((ef, i) => (
        <div key={i} className="effect-row">
          <div className="field-row">
            <div className="field">
              <select
                value={ef.kind}
                onChange={(e) => {
                  const list = effects.slice();
                  list[i] = defaultEffect(e.target.value);
                  onChange(list);
                }}
              >
                {EFFECT_KINDS.map((k) => <option key={k}>{k}</option>)}
              </select>
            </div>
            <button
              className="btn mini danger"
              onClick={() => onChange(effects.filter((_, j) => j !== i))}
            >×</button>
          </div>
          <EffectFields ef={ef} onChange={(nu) => { const l = effects.slice(); l[i] = nu; onChange(l); }} />
        </div>
      ))}
      <button className="btn mini" onClick={() => onChange([...effects, defaultEffect("stat")])}>
        + effect
      </button>
    </div>
  );
}

function defaultEffect(kind: string): Effect {
  switch (kind) {
    case "money": return { kind: "money", delta: 0 };
    case "trait": return { kind: "trait", trait: "lucky", action: "add" };
    case "flag": return { kind: "flag", flag: "flag_name", value: true };
    case "unflag": return { kind: "unflag", flag: "flag_name" };
    case "die": return { kind: "die", cause: "unknown causes" };
    default: return { kind: "stat", stat: "happiness", delta: 0 };
  }
}

function EffectFields({ ef, onChange }: { ef: Effect; onChange: (e: Effect) => void }) {
  switch (ef.kind) {
    case "stat":
      return (
        <div className="field-row">
          <div className="field">
            <select value={ef.stat} onChange={(e) => onChange({ ...ef, stat: e.target.value as typeof ef.stat })}>
              {STAT_KEYS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <input type="number" value={ef.delta} onChange={(e) => onChange({ ...ef, delta: Number(e.target.value) })} />
          </div>
        </div>
      );
    case "money":
      return (
        <div className="field">
          <input type="number" value={ef.delta} onChange={(e) => onChange({ ...ef, delta: Number(e.target.value) })} />
        </div>
      );
    case "trait":
      return (
        <div className="field-row">
          <div className="field">
            <input type="text" value={ef.trait} onChange={(e) => onChange({ ...ef, trait: e.target.value })} />
          </div>
          <div className="field">
            <select value={ef.action} onChange={(e) => onChange({ ...ef, action: e.target.value as "add" | "remove" })}>
              <option value="add">add</option>
              <option value="remove">remove</option>
            </select>
          </div>
        </div>
      );
    case "flag":
      return (
        <div className="field-row">
          <div className="field">
            <input type="text" value={ef.flag} onChange={(e) => onChange({ ...ef, flag: e.target.value })} />
          </div>
          <div className="field">
            <input
              type="text"
              value={JSON.stringify(ef.value)}
              onChange={(e) => onChange({ ...ef, value: parseLiteral(e.target.value) })}
            />
          </div>
        </div>
      );
    case "unflag":
      return (
        <div className="field">
          <input type="text" value={ef.flag} onChange={(e) => onChange({ ...ef, flag: e.target.value })} />
        </div>
      );
    case "die":
      return (
        <div className="field">
          <input type="text" value={ef.cause} onChange={(e) => onChange({ ...ef, cause: e.target.value })} placeholder="cause of death" />
        </div>
      );
  }
}
