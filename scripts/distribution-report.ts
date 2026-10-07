/**
 * Prints the event distribution over many simulated lives.
 * Run: npx vite-node scripts/distribution-report.ts [lives]
 */
import { simulate } from "../src/engine/simulate";
import { bundledCorePack } from "../src/packs/index";

const lives = Number(process.argv[2] ?? 3000);
const corePack = bundledCorePack();
const report = simulate({ lives, packs: [corePack], seedBase: 1 });

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

console.log(`lives=${report.lives}  meanAge=${report.meanAge.toFixed(1)}  events/life=${report.eventsPerLife.toFixed(1)}`);
console.log(`quietYears=${pct(report.quietYears / report.totalYears)} of ${report.totalYears} years`);
console.log(`neverSchooled=${pct(report.neverSchooled)}  neverGraduated=${pct(report.neverGraduated)}`);
console.log(`everEmployed=${pct(report.everEmployed)}  everMarried=${pct(report.everMarried)}  everPrison=${pct(report.everPrison)}`);
console.log();
console.log(
  "event".padEnd(16) +
    "lifeRate".padStart(9) +
    "perLife".padStart(8) +
    "max".padStart(5) +
    "share".padStart(7) +
    "rate|elig".padStart(10) +
    "eligYrs".padStart(8) +
    "  ageRange",
);
const rows = [...report.events.values()].sort((a, b) => b.fires - a.fires);
for (const e of rows) {
  console.log(
    e.id.padEnd(16) +
      pct(e.lifeRate).padStart(9) +
      e.perLife.toFixed(2).padStart(8) +
      String(e.maxPerLife).padStart(5) +
      pct(e.share).padStart(7) +
      pct(e.rateWhenEligible).padStart(10) +
      String(e.eligibleYears).padStart(8) +
      `  ${e.minAge}-${e.maxAge} (μ${e.meanAge.toFixed(0)})`,
  );
}
// events defined in the pack that never fired
const packIds = corePack.events.map((e) => e.id);
const silent = packIds.filter((id) => !report.events.has(id) || report.events.get(id)!.fires === 0);
console.log();
console.log("never fired:", silent.length ? silent.join(", ") : "(none)");
