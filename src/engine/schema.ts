import { z } from "zod";
import { STAT_KEYS, type EventPack } from "./types";

/**
 * Zod schema that mirrors the pack format. Validation is what keeps mod
 * packs safe: a pack is data-only, so once it parses we know it contains no
 * executable content — the engine just walks conditions/weights/effects.
 */

const compareOp = z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]);
const statKey = z.enum(STAT_KEYS);
const id = z.string().min(1).max(128).regex(/^[\w:.-]+$/, "ids may contain letters, digits, _, -, ., :");

const condition: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("all"), conditions: z.array(condition).min(1) }),
    z.object({ kind: z.literal("any"), conditions: z.array(condition).min(1) }),
    z.object({ kind: z.literal("not"), condition }),
    z.object({
      kind: z.literal("age"),
      min: z.number().int().min(0).max(130).optional(),
      max: z.number().int().min(0).max(130).optional(),
    }),
    z.object({ kind: z.literal("stat"), stat: statKey, op: compareOp.optional(), value: z.number() }),
    z.object({ kind: z.literal("money"), op: compareOp.optional(), value: z.number() }),
    z.object({ kind: z.literal("trait"), trait: z.string().min(1).max(64) }),
    z.object({ kind: z.literal("flag"), flag: z.string().min(1).max(64), equals: z.unknown().optional() }),
    z.object({ kind: z.literal("chose"), event: id, choice: id }),
    z.object({
      kind: z.literal("counter"),
      flag: z.string().min(1).max(64),
      op: compareOp.optional(),
      value: z.number(),
    }),
  ]),
);

const weightModifier = z.object({
  when: condition,
  multiply: z.number().min(0).max(100).optional(),
  add: z.number().min(-1000).max(1000).optional(),
});

const effect = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stat"), stat: statKey, delta: z.number().min(-200).max(200) }),
  z.object({ kind: z.literal("money"), delta: z.number().min(-1e9).max(1e9) }),
  z.object({ kind: z.literal("trait"), trait: z.string().min(1).max(64), action: z.enum(["add", "remove"]) }),
  z.object({ kind: z.literal("flag"), flag: z.string().min(1).max(64), value: z.unknown() }),
  z.object({ kind: z.literal("unflag"), flag: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("counter"), flag: z.string().min(1).max(64), delta: z.number().min(-1e9).max(1e9) }),
  z.object({ kind: z.literal("collect"), flag: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("loseitem"), item: id }),
  z.object({ kind: z.literal("die"), cause: z.string().min(1).max(200) }),
]);

const outcome = z.object({
  weight: z.number().min(0).max(1e6),
  weightModifiers: z.array(weightModifier).max(20).optional(),
  effects: z.array(effect).max(50).optional(),
  result: z.string().min(1).max(2000),
  goto: id.optional(),
});

const choice = z.object({
  id,
  text: z.string().min(1).max(300),
  conditions: condition.optional(),
  outcomes: z.array(outcome).min(1).max(20).optional(),
  effects: z.array(effect).max(50).optional(),
  result: z.string().min(1).max(2000).optional(),
  goto: id.optional(),
});

export const simEventSchema = z.object({
  id,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.string().max(64).optional(),
  conditions: condition.optional(),
  weight: z.number().min(0).max(1e6).optional(),
  weightModifiers: z.array(weightModifier).max(20).optional(),
  once: z.boolean().optional(),
  cooldown: z.number().int().min(0).max(100).optional(),
  forced: z.boolean().optional(),
  repeatDecay: z.number().min(0).max(1).optional(),
  choices: z.array(choice).min(1).max(20),
  ui: z.object({ x: z.number(), y: z.number() }).optional(),
});

const gameAction = z.object({
  id,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(64).optional(),
  conditions: condition.optional(),
  cost: z.number().min(0).max(1e9).optional(),
  allowDebt: z.boolean().optional(),
  usesPerYear: z.number().int().min(1).max(100).optional(),
  once: z.boolean().optional(),
  usesBudget: z.boolean().optional(),
  outcomes: z.array(outcome).min(1).max(20).optional(),
  effects: z.array(effect).max(50).optional(),
  result: z.string().min(1).max(2000).optional(),
  goto: id.optional(),
  hint: z.string().max(200).optional(),
});

const shopItem = z.object({
  id,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: z.number().min(0).max(1e9),
  conditions: condition.optional(),
  repeatable: z.boolean().optional(),
  usesPerYear: z.number().int().min(1).max(100).optional(),
  effects: z.array(effect).max(50).optional(),
  passiveEffects: z.array(effect).max(50).optional(),
  hint: z.string().max(200).optional(),
});

const job = z.object({
  id,
  title: z.string().min(1).max(200),
  salary: z.number().int().min(0).max(1e9),
  description: z.string().max(2000).optional(),
  conditions: condition.optional(),
  hireWeight: z.number().min(0).max(100).optional(),
  hireModifiers: z.array(weightModifier).max(20).optional(),
  hint: z.string().max(200).optional(),
});

const statDrift = z.object({
  stat: statKey,
  amount: z.number().min(-100).max(100),
  jitter: z.number().min(0).max(100).optional(),
});

const worldLaw = z.object({
  id,
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  conditions: condition.optional(),
  minAge: z.number().int().min(0).max(130).optional(),
  maxAge: z.number().int().min(0).max(130).optional(),
  everyYears: z.number().int().min(1).max(100).optional(),
  chance: z.number().min(0).max(100).optional(),
  effects: z.array(effect).max(50).optional(),
  drift: z.array(statDrift).max(20).optional(),
  silent: z.boolean().optional(),
});

export const eventPackSchema = z.object({
  id,
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(40),
  description: z.string().max(2000).optional(),
  events: z.array(simEventSchema).min(1).max(500),
  actions: z.array(gameAction).max(200).optional(),
  items: z.array(shopItem).max(200).optional(),
  jobs: z.array(job).max(200).optional(),
  laws: z.array(worldLaw).max(200).optional(),
});

export type ValidationResult =
  | { ok: true; pack: EventPack }
  | { ok: false; errors: string[] };

/** Parse and semantically validate an unknown blob as an event pack. */
export function validatePack(data: unknown): ValidationResult {
  const parsed = eventPackSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    };
  }
  const pack = parsed.data as EventPack;

  // Semantic checks the schema can't express.
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const ev of pack.events) {
    if (ids.has(ev.id)) errors.push(`duplicate event id "${ev.id}"`);
    ids.add(ev.id);
    const choiceIds = new Set<string>();
    for (const ch of ev.choices) {
      if (choiceIds.has(ch.id)) errors.push(`event "${ev.id}": duplicate choice id "${ch.id}"`);
      choiceIds.add(ch.id);
      if (!ch.outcomes && !ch.result) {
        errors.push(`event "${ev.id}" choice "${ch.id}": needs "outcomes" or "result"`);
      }
    }
  }
  const checkGoto = (gotoId: string | undefined, where: string) => {
    if (gotoId && !ids.has(gotoId)) errors.push(`${where}: goto target "${gotoId}" does not exist`);
  };
  for (const ev of pack.events) {
    for (const ch of ev.choices) {
      checkGoto(ch.goto, `event "${ev.id}" choice "${ch.id}"`);
      for (const o of ch.outcomes ?? []) {
        checkGoto(o.goto, `event "${ev.id}" choice "${ch.id}" outcome`);
      }
    }
  }
  // Actions/items/jobs/laws share the pack's id namespace and need unique ids.
  for (const list of [pack.actions ?? [], pack.items ?? [], pack.jobs ?? [], pack.laws ?? []]) {
    for (const entry of list) {
      if (ids.has(entry.id)) errors.push(`duplicate id "${entry.id}"`);
      ids.add(entry.id);
      // Note: action gotos are intentionally not checked — actions may chain
      // into events defined by other packs, resolvable only at runtime.
    }
  }
  // World laws must actually do something, over a valid age window.
  for (const law of pack.laws ?? []) {
    if (!law.effects?.length && !law.drift?.length) {
      errors.push(`world law "${law.id}": needs "effects" or "drift"`);
    }
    if (law.minAge !== undefined && law.maxAge !== undefined && law.minAge >= law.maxAge) {
      errors.push(`world law "${law.id}": minAge must be less than maxAge`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, pack };
}
