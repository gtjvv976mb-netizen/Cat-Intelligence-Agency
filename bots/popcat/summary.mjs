/**
 * THE RUN'S JOB SUMMARY: WHAT THE OWNER READS IN THE ACTIONS TAB.
 *
 * GitHub renders $GITHUB_STEP_SUMMARY as Markdown. A coin's name, ticker and draft are a
 * stranger's text, so they never reach it as Markdown: the summary is written as HTML blocks
 * only (a block's inside is not read as Markdown, and no link is made of a web address in it),
 * each block on lines of its own with no blank line inside, and every character of a stranger's
 * text that is not a letter, a digit or a space is written as a numeric character reference. So
 * no name can open a tag, a link, a table, a heading or a code span, and no line of the summary
 * starts with anything but "<", so none can be read as a workflow command either (GitHub reads
 * those from a step's output, not from this file; the logger guards that side).
 * The only link in it is to the coin's pump.fun page, built from an address the validator passed.
 */
import { CHECKS, PUMP_PAGE, PICK_DISCLOSURE, ticker } from "../../site/assets/callouts.js";

/** A stranger's text, safe inside an HTML block: letters, digits and spaces as they are, everything else by number. */
export const esc = (s) => String(s ?? "").replace(/[^\p{L}\p{N} ]/gu, (c) => `&#${c.codePointAt(0)};`);
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
const count = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (x) => `${Number(x.toFixed(x < 10 ? 2 : 1))}%`;
const coin = (c) => `${esc(c.name)} (${esc(ticker(c.symbol))})`;
const pumpLink = (mint) => (ADDRESS.test(mint) ? `<a href="${PUMP_PAGE}${mint}">${mint}</a>` : esc(mint));
const MAX_ROWS = 100;

/** The summary of one run (runPopcat's result), as a string to append to $GITHUB_STEP_SUMMARY. */
export function summaryMarkdown(r) {
  const out = [];
  out.push(`<h2>Popcat, ${r.mode === "live" ? "live: what it published" : "dry run: nothing published"}</h2>`);
  const l = r.listing;
  const reach = l ? ` The newest listing: ${l.pages} page${l.pages === 1 ? "" : "s"}${l.oldestMs ? `, back to coins created at ${hhmm(l.oldestMs)} UTC` : ""}${l.gap ? `; coins created from ${hhmm(l.gap.fromMs)} to ${hhmm(l.gap.toMs)} UTC could not be listed` : ""}${l.stoppedBy ? `; it stopped early at ${esc(l.stoppedBy)}, and the next run reads that stretch again` : ""}.` : "";
  const c = r.counts;
  out.push(`<p>Run at ${utc(r.at)}. Coins read: ${count(c.read)}.${reach} Cat coins new to Popcat: ${count(c.queued)}. Checked this run: ${count(c.checked)} (${count(c.callouts)} with no red flags, ${count(c.spotted)} spotted with red flags). Waiting for a later run: ${count(c.waiting)} (${count(c.left)} of them over this run's budget). Dropped: ${count(c.dropped)}.</p>`);

  const p = r.pick;
  const win = p ? `${hhmm(p.windowStart)} to ${hhmm(p.windowStart + 6 * 3_600_000)} UTC on ${new Date(p.windowStart).toISOString().slice(0, 10)}` : "";
  if (p && p.due && p.pick) {
    const k = p.pick;
    out.push(`<h3>Popcat's pick for ${win}${r.mode === "live" ? "" : " (dry run: not recorded)"}</h3>`);
    out.push([
      "<table>",
      `<tr><th>Coin</th><td>${coin(k)}</td></tr>`,
      `<tr><th>Its page on pump.fun</th><td>${pumpLink(k.mint)}</td></tr>`,
      `<tr><th>Checked</th><td>${utc(Date.parse(k.checked))}, no red flags in any check</td></tr>`,
      `<tr><th>Holders besides the curve and pools</th><td>${count(k.stats.holders)}</td></tr>`,
      `<tr><th>Transactions on its curve</th><td>${k.stats.txs === null ? "not counted" : count(k.stats.txs)}</td></tr>`,
      `<tr><th>Bonding curve sold</th><td>${pct(k.stats.curvePct)}</td></tr>`,
      `<tr><th>Top 10 holders hold</th><td>${pct(k.stats.top10Pct)}</td></tr>`,
      `<tr><th>Chosen from</th><td>${count(p.pool)} coin${p.pool === 1 ? "" : "s"} with no red flags checked in the six hours before</td></tr>`,
      "</table>",
    ].join("\n"));
    out.push("<p><b>The draft</b>, to select and copy yourself:</p>");
    out.push(`<pre>${esc(k.draft)}</pre>`);
    out.push("<p>Post it only by hand, in the pump.fun app, from your own single account: pump.fun's terms forbid bots, scripts or other automation to create callouts, and allow one callout every six hours. Hold none of the coin, and keep the draft's disclosure. Read the coin's checks at its desk first: they were true when it was checked, not necessarily now.</p>");
    out.push(`<p>${esc(PICK_DISCLOSURE)}</p>`);
  } else if (p && p.due) {
    out.push(`<h3>No pick for ${win}</h3>`);
    out.push(`<p>No cat coin checked in the six hours before this run passed every check${p.passedOver ? `, apart from ${count(p.passedOver)} whose own name or ticker a draft may not print` : ""}.${r.mode === "live" ? " This window has no pick." : ""}</p>`);
  } else if (p) {
    out.push(`<p>The pick for ${win} was already tried by an earlier run.</p>`);
  }

  if (r.entries.length) {
    out.push("<h3>Checked this run</h3>");
    const rows = r.entries.slice(0, MAX_ROWS).map((e) => `<tr><td>${e.callout ? "No red flags found" : `Red flags (${e.flags.length})`}</td><td>${coin(e)}</td><td>${e.flags.map((f) => esc(CHECKS[f.id].label)).join("; ") || "none"}</td></tr>`);
    out.push(["<table>", "<tr><th>Verdict</th><th>Coin</th><th>Red flags</th></tr>", ...rows, "</table>"].join("\n"));
    if (r.entries.length > MAX_ROWS) out.push(`<p>And ${count(r.entries.length - MAX_ROWS)} more, in the log.</p>`);
  }
  if (r.dropped.length) {
    out.push("<h3>Dropped</h3>");
    out.push(["<ul>", ...r.dropped.slice(0, MAX_ROWS).map((d) => `<li>${coin(d)}, ${esc(d.mint)}: ${esc(d.why)}</li>`), "</ul>"].join("\n"));
  }
  return out.join("\n\n") + "\n\n";
}

/** What the summary says when the run stopped: the message is redacted by the caller, and escaped here. */
export function summaryOfError(message) {
  return `<h2>Popcat stopped</h2>\n\n<p>${esc(message)}</p>\n\n`;
}
