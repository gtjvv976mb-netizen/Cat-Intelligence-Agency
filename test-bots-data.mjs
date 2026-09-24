/**
 * THE DATA THE SITE IS ABOUT TO PUBLISH.
 *
 * Run by every deploy right after bots/floor-data.mjs has overlaid the floor-data branch's
 * launches.json and callouts.json onto site/assets/ (and by the suite, where they are main's
 * empty copies). Whatever their count, every entry must pass the site's own validator with no
 * problem at all, no callout may be on a coin CashCat launched, and nothing a dry run would
 * write may be there: a launch always carries the transaction that made it.
 */
import fs from "node:fs";
import path from "node:path";
import { harness, ROOT } from "./bots/test/doubles.mjs";
import { validateLaunches } from "./site/assets/launches.js";
import { validateCallouts } from "./site/assets/callouts.js";

const { ok, section, done } = harness("test-bots-data");
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "site", "assets", f), "utf8")); } catch (e) { return { error: e.message }; } };

section("site/assets/launches.json");
const lraw = read("launches.json");
ok("it parses and is { \"launches\": [...] } and nothing else", Array.isArray(lraw.launches) && JSON.stringify(Object.keys(lraw)) === '["launches"]', lraw.error ?? "");
const lv = validateLaunches(lraw);
ok(`every entry passes the validator (${lraw.launches?.length ?? 0} on file)`, lv.problems.length === 0 && lv.launches.length === (lraw.launches?.length ?? -1), lv.problems.join(" | "));
ok("every launch names its transaction, its mint and CashCat's wallet", lv.launches.every((l) => l.tx && l.mint && l.creator));
ok("one wallet made every launch", new Set(lv.launches.map((l) => l.creator)).size <= 1);

section("site/assets/callouts.json");
const craw = read("callouts.json");
ok("it parses and is { \"callouts\": [...] } and nothing else", Array.isArray(craw.callouts) && JSON.stringify(Object.keys(craw)) === '["callouts"]', craw.error ?? "");
const cv = validateCallouts(craw, { exclude: lv.launches });
ok(`every entry passes the validator, and none is a CashCat coin (${craw.callouts?.length ?? 0} on file)`, cv.problems.length === 0 && cv.callouts.length === (craw.callouts?.length ?? -1), cv.problems.join(" | "));

section("NOTHING ELSE OF THE BOTS' IS PUBLISHED");
ok("Popcat's memory (popcat-state.json) is not in the site", !fs.existsSync(path.join(ROOT, "site", "assets", "popcat-state.json")));

done();
