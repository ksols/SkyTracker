export type PlannedSprint = {
  number: number;
  name: string;
  start: Date;
  finish: Date;
};

const DAY = 24 * 60 * 60 * 1000;
const addDays = (date: Date, n: number) => new Date(date.getTime() + n * DAY);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** First Monday strictly after `date` (UTC). getUTCDay(): Sun=0..Sat=6, Mon=1. */
export function nextMondayAfter(date: Date): Date {
  let d = addDays(date, 1);
  while (d.getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}

export function computeSprintPlan(input: {
  lastNumber: number;
  lastFinish: Date;
  count: number;
  skip: string[];
}): PlannedSprint[] {
  const skip = new Set(input.skip);
  const plan: PlannedSprint[] = [];
  let start = nextMondayAfter(input.lastFinish);

  for (let i = 0; i < input.count; i++) {
    while (skip.has(isoDay(start))) start = addDays(start, 7);
    const finish = addDays(start, 11); // Monday → second Friday
    const number = input.lastNumber + i + 1;
    plan.push({ number, name: `Sprint ${number}`, start, finish });
    start = nextMondayAfter(finish);
  }
  return plan;
}
