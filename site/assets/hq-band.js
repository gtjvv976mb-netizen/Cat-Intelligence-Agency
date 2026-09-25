/* THE HOME PAGE'S AGENCY HQ BAND.
   Offline, it keeps its honest "coming online" line and calls nothing. Online, it reads HQ's
   summary once, through hq-client.js, and shows four numbers from one mode's block (live when
   any agent trades real SOL, paper otherwise), each marked with that mode: agents at work,
   realized trading P&L, win rate and the deepest drawdown. The HQ page has the rest. */
import { hqClient } from "./hq-client.js";
import { modeRecord, decSign } from "./hq-format.js";
import { $, el, sol, pct, stat, setPill, whyNot } from "./hq-ui.js";

const hq = hqClient();
const pill = $("#band-pill"), box = $("#band-stats");

async function load() {
  setPill(pill, "connecting");
  let s;
  try { s = (await hq.summary()).value; } catch (e) {
    setPill(pill, "down");
    box.replaceChildren(el("p", "band-soon", `${whyNot(e)} Its figures are shown only when it answers.`));
    return;
  }
  setPill(pill, "online");
  const mode = s.live.agents.total > 0 ? "live" : "paper";
  const t = modeRecord(s[mode]);
  if (!t.hasAgents) { box.replaceChildren(el("p", "band-soon", "HQ is online, and no agent is hired yet. The first one shows here the moment it is.")); return; }
  box.replaceChildren(
    stat({ label: "Agents at work", value: el("span", "amt", String(t.agents.active)), sub: `of ${t.agents.total} ${mode}`, mode }),
    stat({ label: "Trading P&L, realized", value: sol(t.tradingPnlSol.realized, { signed: true }), mode }),
    stat({ label: "Win rate", value: t.winRatePct === null ? el("span", "amt flat", "n/a") : el("span", "amt", `${t.winRatePct}%`), sub: `${t.wins} won · ${t.losses} lost`, mode }),
    stat({ label: "Deepest drawdown", value: t.maxDrawdownPct === null ? el("span", "amt flat", "n/a") : pct(decSign(t.maxDrawdownPct) > 0 ? `-${t.maxDrawdownPct}` : t.maxDrawdownPct), mode }),
  );
}

if (hq.online) load().catch((e) => console.warn("Agency HQ:", e && e.message));
