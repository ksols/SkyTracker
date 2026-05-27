import "dotenv/config";
import { computeSprintPlan } from "./lib/sprint-cadence";
import {
  listSprintIterations,
  createIterationNode,
  registerTeamIteration,
} from "./lib/ado-iterations";

function parseArgs(argv: string[]) {
  const args = { count: 6, skip: [] as string[], apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--count") args.count = parseInt(argv[++i], 10);
    else if (a === "--skip") args.skip = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (!Number.isFinite(args.count) || args.count < 1) throw new Error("--count must be a positive integer");
  return args;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function latestSprint(existing: { name: string; finishDate?: string }[]) {
  let lastNumber = 0;
  let lastFinish = new Date(0);
  for (const it of existing) {
    const m = it.name.match(/^Sprint (\d+)/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > lastNumber) {
      lastNumber = n;
      lastFinish = it.finishDate ? new Date(it.finishDate) : lastFinish;
    }
  }
  if (lastNumber === 0) throw new Error("No existing 'Sprint N' iterations found to anchor the cadence");
  return { lastNumber, lastFinish };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const existing = await listSprintIterations();
  const existingNames = new Set(existing.map((e) => e.name));
  const { lastNumber, lastFinish } = latestSprint(existing);

  // Append semantics: the plan always projects forward from the latest existing
  // sprint, so each --apply adds `count` NEW sprints (it is not idempotent —
  // re-running appends more). The dry-run below is the safety check. The
  // existing-name filter only guards a manual out-of-band collision.
  const plan = computeSprintPlan({ lastNumber, lastFinish, count: args.count, skip: args.skip });

  console.log(`\nLatest existing: Sprint ${lastNumber} (ends ${isoDay(lastFinish)})`);
  console.log(args.apply ? "Mode: APPLY\n" : "Mode: DRY RUN (use --apply to create)\n");
  for (const s of plan) {
    const exists = existingNames.has(s.name);
    console.log(`  ${s.name.padEnd(12)} ${isoDay(s.start)} → ${isoDay(s.finish)}${exists ? "   [exists, skip]" : ""}`);
  }
  console.log("");

  if (!args.apply) return;

  let failures = 0;
  const toCreate = plan.filter((s) => !existingNames.has(s.name));
  for (const s of toCreate) {
    try {
      const identifier = await createIterationNode(s.name, s.start, s.finish);
      try {
        await registerTeamIteration(identifier);
        console.log(`  created + registered ${s.name}`);
      } catch (e) {
        failures++;
        console.error(`  ${s.name}: node created but team registration FAILED — ${(e as Error).message}`);
      }
    } catch (e) {
      failures++;
      console.error(`  ${s.name}: create FAILED — ${(e as Error).message}`);
    }
  }
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
