/**
 * A FIVE-FIELD CRON, IN UTC: minute hour day-of-month month day-of-week.
 * Each field is *, a number, a range a-b, a list a,b,c, or any of those with a step /n.
 * Day of week is 0-6, Sunday 0 (7 is also Sunday). When both day fields are restricted, a
 * day matches either, as in classic cron. Enough for HQ's schedules and nothing more.
 */
const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
];

export class CronError extends Error {
  constructor(message) { super(message); this.name = "CronError"; }
}

function parseField(text, { name, min, max }) {
  const out = new Set();
  for (const part of text.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new CronError(`the ${name} field "${text}" is not cron syntax`);
    let lo = min, hi = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a; hi = b === undefined ? (m[2] ? max : a) : b;
    }
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (!(lo >= min && hi <= max && lo <= hi && step >= 1)) throw new CronError(`the ${name} field "${text}" is out of range ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(name === "day of week" && v === 7 ? 0 : v);
  }
  return out;
}

export function parseCron(expr) {
  const parts = String(expr ?? "").trim().split(/\s+/);
  if (parts.length !== 5) throw new CronError(`a cron schedule has five fields, got ${JSON.stringify(expr)}`);
  const sets = parts.map((p, i) => parseField(p, FIELDS[i]));
  return Object.freeze({ expr: parts.join(" "), minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4],
    domAny: parts[2] === "*", dowAny: parts[4] === "*" });
}

export function cronMatches(cron, ms) {
  const d = new Date(ms);
  if (!cron.minute.has(d.getUTCMinutes()) || !cron.hour.has(d.getUTCHours()) || !cron.month.has(d.getUTCMonth() + 1)) return false;
  const domHit = cron.dom.has(d.getUTCDate()), dowHit = cron.dow.has(d.getUTCDay());
  if (cron.domAny && cron.dowAny) return true;
  if (cron.domAny) return dowHit;
  if (cron.dowAny) return domHit;
  return domHit || dowHit;
}

/** The first minute strictly after `ms` that the schedule names (searches up to 400 days). */
export function nextRun(cronOrExpr, ms) {
  const cron = typeof cronOrExpr === "string" ? parseCron(cronOrExpr) : cronOrExpr;
  let t = Math.floor(ms / 60_000) * 60_000 + 60_000;
  const limit = t + 400 * 86_400_000;
  while (t < limit) {
    if (cronMatches(cron, t)) return t;
    t += 60_000;
  }
  throw new CronError(`the schedule ${cron.expr} never runs`);
}
