/* CASHCAT'S LAUNCHES AND POPCAT'S CALLOUTS, AS A PAGE READS THEM.

   The two bots write site/assets/launches.json and callouts.json. The files live on the
   floor-data branch and are laid over the site at every deploy, after the same checks as here
   have passed them. A page reads each one as a JSON module through a loader of its own
   (launches-data.js, callouts-data.js), so a file that cannot be read fails only its own
   import; checks every entry again with launches.js and callouts.js; and refuses a callout on
   any coin CashCat launched. Callouts are shown only when the launches could be read to check
   them against. This module touches no page: the floor and the home page import it. */
import { validateLaunches } from "./launches.js";
import { validateCallouts } from "./callouts.js";

export const BOT_NOUNS = { cashcat: ["launch", "launches"], popcat: ["callout", "callouts"] };

/** "no launches yet", "1 launch", "12 launches". */
export function botTally(cat, n) {
  const [one, many] = BOT_NOUNS[cat];
  return n ? `${n} ${n === 1 ? one : many}` : `no ${many} yet`;
}

const why = (e) => (e && e.message ? e.message : String(e));

/** { launches: { state, items }, callouts: { state, items } }, state "ready" or "failed". */
export async function loadBotPosts(warn = (...a) => console.warn(...a)) {
  const [l, c] = await Promise.allSettled([import("./launches-data.js"), import("./callouts-data.js")]);
  const launches = { state: "failed", items: [] }, callouts = { state: "failed", items: [] };
  if (l.status === "fulfilled") {
    const v = validateLaunches(l.value.default);
    for (const p of v.problems) warn("launches.json:", p);
    launches.state = "ready";
    launches.items = v.launches;
  } else warn("launches.json could not be read:", why(l.reason));
  if (c.status !== "fulfilled") warn("callouts.json could not be read:", why(c.reason));
  else if (launches.state !== "ready") warn("callouts.json: not shown, because CashCat's launches could not be read to check them against");
  else {
    const v = validateCallouts(c.value.default, { exclude: launches.items });
    for (const p of v.problems) warn("callouts.json:", p);
    callouts.state = "ready";
    callouts.items = v.callouts;
  }
  return { launches, callouts };
}
