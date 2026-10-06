import type { LifeSim } from "../engine/engine";
import {
  actionsLeft,
  applyForJob,
  buyItem,
  listActions,
  listItems,
  listJobs,
  performAction,
  quitJob,
} from "../engine/actions";

interface Props {
  sim: LifeSim;
  /** Called after any action mutates the sim so the parent can re-render. */
  onAct: () => void;
}

/**
 * The "things to do" panel: jobs, shop, casino and per-year life actions.
 * All content comes from loaded packs — every button is pack data, and
 * disabled entries show why they're locked.
 */
export default function ActionsPanel({ sim, onAct }: Props) {
  const c = sim.character;
  const busy = !!sim.pending || !c.alive;

  const jobs = listJobs(sim);
  const items = listItems(sim);
  const life = listActions(sim, "life");
  const casino = listActions(sim, "casino");
  const other = listActions(sim).filter(
    (s) => !["life", "casino"].includes(s.action.category ?? "life"),
  );
  const budget = actionsLeft(sim);

  const act = (fn: () => unknown) => {
    fn();
    onAct();
  };

  return (
    <div className="panel actions-panel">
      <h3>Actions</h3>
      {busy && (
        <div className="action-note">
          {c.alive ? "Resolve the event first." : "This life is over."}
        </div>
      )}

      <details className="action-group" open>
        <summary>
          Life <span className="action-badge">{budget} left</span>
        </summary>
        {life.map((s) => (
          <ActionRow
            key={s.action.id}
            title={s.action.title}
            sub={s.action.description}
            disabled={busy || !s.eligible}
            reason={s.reason}
            onClick={() => act(() => performAction(sim, s.action.id))}
          />
        ))}
        {other.map((s) => (
          <ActionRow
            key={s.action.id}
            title={s.action.title}
            sub={s.action.description}
            disabled={busy || !s.eligible}
            reason={s.reason}
            onClick={() => act(() => performAction(sim, s.action.id))}
          />
        ))}
      </details>

      <details className="action-group" open>
        <summary>
          Jobs
          {c.flags.job ? <span className="action-badge">{String(c.flags.job)}</span> : null}
        </summary>
        {c.flags.employed ? (
          <button className="action-btn danger-lite" disabled={busy} onClick={() => act(() => quitJob(sim))}>
            Quit job
          </button>
        ) : null}
        {jobs.map((s) => (
          <ActionRow
            key={s.job.id}
            title={`${s.job.title} — $${s.job.salary.toLocaleString()}/yr`}
            sub={s.job.description}
            disabled={busy || !s.eligible}
            reason={s.reason}
            onClick={() => act(() => applyForJob(sim, s.job.id))}
          />
        ))}
      </details>

      <details className="action-group" open>
        <summary>Shop</summary>
        {items.map((s) => (
          <ActionRow
            key={s.item.id}
            title={`${s.item.name} — $${s.item.price.toLocaleString()}`}
            sub={s.item.description}
            disabled={busy || !s.eligible}
            reason={s.owned && !s.item.repeatable ? "Owned" : s.reason}
            onClick={() => act(() => buyItem(sim, s.item.id))}
          />
        ))}
      </details>

      <details className="action-group">
        <summary>Casino</summary>
        {casino.map((s) => (
          <ActionRow
            key={s.action.id}
            title={s.action.title}
            sub={s.action.description}
            disabled={busy || !s.eligible}
            reason={s.reason}
            onClick={() => act(() => performAction(sim, s.action.id))}
          />
        ))}
      </details>
    </div>
  );
}

function ActionRow({
  title,
  sub,
  disabled,
  reason,
  onClick,
}: {
  title: string;
  sub?: string;
  disabled: boolean;
  reason?: string;
  onClick: () => void;
}) {
  return (
    <button className="action-btn" disabled={disabled} onClick={onClick}>
      <span className="action-title">{title}</span>
      {sub && <span className="action-sub">{sub}</span>}
      {!disabled ? null : reason ? <span className="action-reason">{reason}</span> : null}
    </button>
  );
}
