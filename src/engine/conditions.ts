import type { Character, CompareOp, Condition, JobRecord } from "./types";

function compare(actual: number, op: CompareOp, value: number): boolean {
  switch (op) {
    case "gt":
      return actual > value;
    case "gte":
      return actual >= value;
    case "lt":
      return actual < value;
    case "lte":
      return actual <= value;
    case "eq":
      return actual === value;
    case "neq":
      return actual !== value;
  }
}

/** Evaluate a condition tree against the character. Missing condition = true. */
export function evalCondition(cond: Condition | undefined, c: Character): boolean {
  if (!cond) return true;
  switch (cond.kind) {
    case "all":
      return cond.conditions.every((k) => evalCondition(k, c));
    case "any":
      return cond.conditions.some((k) => evalCondition(k, c));
    case "not":
      return !evalCondition(cond.condition, c);
    case "age":
      return (
        (cond.min === undefined || c.age >= cond.min) &&
        (cond.max === undefined || c.age <= cond.max)
      );
    case "stat":
      return compare(c.stats[cond.stat], cond.op ?? "gte", cond.value);
    case "money":
      return compare(c.money, cond.op ?? "gte", cond.value);
    case "trait":
      return c.traits.includes(cond.trait);
    case "flag":
      return "equals" in cond
        ? c.flags[cond.flag] === cond.equals
        : Boolean(c.flags[cond.flag]);
    case "chose":
      return c.history[cond.event] === cond.choice;
    case "job": {
      const matches = (j: { id?: string; title?: string; field?: string }) =>
        (cond.id === undefined || j.id === cond.id) &&
        (cond.title === undefined || j.title === cond.title) &&
        (cond.field === undefined || j.field === cond.field);
      const current = {
        id: c.flags.job_id as string | undefined,
        title: c.flags.job as string | undefined,
        field: c.flags.job_field as string | undefined,
      };
      const employed = Boolean(c.flags.employed || current.id || current.title);
      const bare =
        cond.id === undefined && cond.title === undefined && cond.field === undefined;
      if (!cond.ever) {
        if (bare) return employed;
        return employed && matches(current);
      }
      // "ever": the career record — hire history plus the current job.
      if (bare) {
        const hist = (c.flags.job_history as JobRecord[] | undefined) ?? [];
        return hist.length > 0 || employed;
      }
      if (employed && matches(current)) return true;
      const hist = (c.flags.job_history as JobRecord[] | undefined) ?? [];
      if (hist.some((j) => matches(j))) return true;
      // applyForJob also marks history["job_<id>"] = "hired" on every hire.
      if (cond.id !== undefined && c.history[`job_${cond.id}`] === "hired") {
        return cond.title === undefined && cond.field === undefined;
      }
      return false;
    }
    case "counter":
      return compare(Number(c.flags[cond.flag] ?? 0), cond.op ?? "gte", cond.value);
    case "person":
      return c.people.some((p) => {
        if (!p.alive || p.gone) return false;
        if (cond.relation && !cond.relation.includes(p.relation)) return false;
        if (cond.minRel !== undefined && p.rel < cond.minRel) return false;
        if (cond.maxRel !== undefined && p.rel > cond.maxRel) return false;
        return true;
      });
    case "ailment":
      return cond.ailment
        ? c.ailments.some((a) => a.defId === cond.ailment)
        : c.ailments.length > 0;
  }
}

/** Base weight adjusted by every matching modifier: multiply first, then add. */
export function effectiveWeight(
  base: number,
  modifiers: { when: Condition; multiply?: number; add?: number }[] | undefined,
  c: Character,
): number {
  let w = base;
  for (const m of modifiers ?? []) {
    if (!evalCondition(m.when, c)) continue;
    if (m.multiply !== undefined) w *= m.multiply;
    if (m.add !== undefined) w += m.add;
  }
  return Math.max(0, w);
}
