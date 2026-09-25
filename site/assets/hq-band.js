/* THE HOME PAGE'S AGENCY HQ BAND.
   Offline, it keeps its honest "coming online" line and calls nothing. Online, it reads the
   summary and the agents once, through hq-client.js, and shows four numbers for one mode (live
   when any agent trades real SOL, paper otherwise), each marked with that mode: agents at work,
   realized trading P&L, win rate and the deepest drawdown. The HQ page has the rest. */
import { hqClient } from "./hq-client.js";
import { modeTotals, decSign } from "./hq-format.js";
import { $, el, sol, pct, stat, setPill, whyNot } from "./hq-ui.js";

const hq = hqClient();
const pill = $("#band-pill"), box = $("#band-stats");

async function load() {
  setPill(pill, "connecting");
  const [s, a] = await Promise.allSettled([hq.summary(), hq.agents()]);
  if (a.status === "rejected") {
    setPill(pill, "down");
    const p = el("p", "band-soon", `${whyNot(a.reason)} Its figures are shown only when it answers.`);
    box.replaceChildren(p);
    return;
  }
  const T = modeTotals(a.value.value.agents);
  const summary = s.status === "fulfilled" ? s.value.value : null;
  const mode = summary && summary.mode !== "mixed" ? summary.mode : T.live.agents ? "live" : "paper";
  const t = T[mode];
  const realized = summary && summary.mode === mode ? summary.tradingPnlSol.realized : t.realizedPnlSol;
  box.replaceChildren(
    stat({ label: "Agents at work", value: el("span", "amt", String(t.active)), sub: `of ${t.agents} ${mode}`, mode }),
    stat({ label: "Trading P&L, realized", value: sol(realized, { signed: true }), mode }),
    stat({ label: "Win rate", value: t.winRatePct === null ? el("span", "amt flat", "n/a") : el("span", "amt", `${t.winRatePct}%`), sub: `${t.wins} won · ${t.losses} lost`, mode }),
    stat({ label: "Deepest drawdown", value: t.worstDrawdownPct === null ? el("span", "amt flat", "n/a") : pct(decSign(t.worstDrawdownPct) > 0 ? `-${t.worstDrawdownPct}` : t.worstDrawdownPct), mode }),
  );
  setPill(pill, "online");
}

if (hq.online) load().catch((e) => console.warn("Agency HQ:", e && e.message));
