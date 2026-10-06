import type { Character, CompareOp, Condition } from "./types";

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
    case "counter":
      return compare(Number(c.flags[cond.flag] ?? 0), cond.op ?? "gte", cond.value);
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
