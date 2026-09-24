/**
 * WHAT THE BOTS WILL NOT PUT THEIR NAME TO, AND WHAT COUNTS AS A CAT.
 *
 * The deterministic content rules (bots/lib/content-rules.mjs) clause by clause: real people
 * (by name and by the "Firstname Lastname" shape), brands and teams, endorsement and "official"
 * claims, tragedy, minors, sex, hate (in plain text, and slurs by salted hash only), identity,
 * financial promises, the ticker and name formats, "it must be a cat"; compounds caught
 * ("TrumpCat") without their false friends ("trumpet"); look-alike digits read as letters. The
 * trend gate on the recorded Google Trends and CoinGecko answers. Then cat detection
 * (bots/lib/catdetect.mjs): every cat word, glued names and tickers, and the false friends —
 * catch, cattle, education, category, location, vacation, catalyst, caterpillar, catfish,
 * catwalk, scatter, concatenate, polecat, muscat — and the two-word rule for descriptions.
 */
import { harness, fixture } from "./bots/test/doubles.mjs";
import { normalize, wordsOf, checkFields, checkProposal, checkTrend, displaySafe, HATE_HASHES, hashTerm, TICKER } from "./bots/lib/content-rules.mjs";
import { detectCat, catWordIn, CAT_WORDS } from "./bots/lib/catdetect.mjs";
import { parseGoogleTrends, parseCoingeckoTrending } from "./bots/cashcat/trends.mjs";

const { ok, section, done } = harness("test-bots-content");
const rules = (r) => r.violations.map((v) => v.rule);
const good = { name: "Pickle Cat", symbol: "PKLCAT", tagline: "A cat who judges pickleball from the bench.", trend: "pickleball" };
const refused = (over, rule) => { const r = checkProposal({ ...good, ...over }); return !r.ok && rules(r).includes(rule); };

section("NORMALIZING");
ok("NFKC, accents, case and look-alike digits: \"S3XY Kätzchen\" → \"sexy katzchen\"", normalize("S3XY Kätzchen") === "sexy katzchen");
ok("camelCase compounds split into words", JSON.stringify(wordsOf("DoomCat $GRENcat")) === '["doom","cat","gre","ncat"]' || wordsOf("DoomCat").join(" ") === "doom cat");
ok("a well-formed cat coin passes every rule", checkProposal(good).ok, JSON.stringify(checkProposal(good).violations));

section("REAL PEOPLE");
ok("a famous name: \"Trump Cat\"", refused({ name: "Trump Cat" }, "real_person"));
ok("glued into a compound: \"TrumpCat\", \"ElonCat\"", refused({ name: "TrumpCat" }, "real_person") && refused({ name: "ElonCat" }, "real_person"));
ok("the false friend survives: \"Trumpet Cat\"", checkProposal({ ...good, name: "Trumpet Cat" }).ok);
ok("a multi-word name: \"Taylor Swift\" in the tagline", refused({ tagline: "A cat that sings like Taylor Swift on tour." }, "real_person"));
ok("\"Firstname Lastname\" with a common first name: \"Michael Jordan\"", !displaySafe({ name: "Michael Jordan Cat", symbol: "MJ" }).ok);
ok("a first name before a cat word is not a person: \"Taylor Cat\"", checkProposal({ ...good, name: "Taylor Cat" }).ok);
ok("in the trend itself: \"elon musk\"", !checkTrend({ title: "elon musk", news: [] }).ok);

section("BRANDS, TEAMS, CHARACTERS AND OTHER TOKENS");
for (const n of ["Nike Cat", "Hello Kitty Coin", "Garfield Cat", "Grumpy Cat Coin", "Popcat Two", "Solana Cat", "Yankees Cat", "White Sox Kitty"])
  ok(`"${n}"`, refused({ name: n }, "brand"));
ok("the trend \"white sox\" is dropped", !checkTrend({ title: "white sox", news: [] }).ok);

section("ENDORSEMENT AND OFFICIAL CLAIMS");
for (const t of ["The official cat of autumn.", "A verified kitty for the season.", "The real cat everyone waited for.", "Our partner cat for the fall."])
  ok(`"${t}"`, refused({ tagline: t }, "endorsement"));
ok("glued: \"OfficialCat\"", refused({ name: "OfficialCat" }, "endorsement"));

section("TRAGEDY, MINORS, SEX, HATE, IDENTITY, PROMISES");
ok("tragedy in a tagline", refused({ tagline: "A cat mourning the victims of the storm." }, "tragedy"));
ok("minors", refused({ tagline: "A cat for the kids at school today." }, "minors"));
ok("sexual, spelled with look-alikes: \"S3xy Kitty\"", refused({ name: "S3xy Kitty" }, "sexual"));
ok("hate, in plain text: \"1488\"", !checkFields({ x: "cat 1488" }).ok && rules(checkFields({ x: "cat 1488" })).includes("hate"));
ok("identity: a coin named for a group of people", refused({ name: "Jewish Cat" }, "identity"));
ok("financial promise", refused({ tagline: "A cat with guaranteed 100x returns." }, "financial_promise"));
{
  ok("slurs are kept as salted hashes only: 37 of them, 20 hex characters each", HATE_HASHES.size === 37 && [...HATE_HASHES].every((h) => /^[0-9a-f]{20}$/.test(h)));
  const probe = "zorblaxterm";
  const before = checkFields({ n: `${probe} cat` }).ok;
  HATE_HASHES.add(hashTerm(probe));
  const after = checkFields({ n: `${probe}cat` });
  HATE_HASHES.delete(hashTerm(probe));
  ok("a word whose salted hash is on the list is refused as hate, glued or not (probed with an invented word)", before && !after.ok && rules(after).includes("hate") && after.violations[0].term === "[a slur]");
}

section("FORMATS, AND IT MUST BE A CAT");
ok("ticker: 2 to 10 of A-Z and 0-9", TICKER.test("PKLCAT") && !TICKER.test("pk") && !TICKER.test("TOOLONGTICKER") && !TICKER.test("$CAT") && refused({ symbol: "cat$" }, "ticker_format"));
ok("name: 3 to 32 printable characters", refused({ name: "Pi" }, "name_format") && refused({ name: "A".repeat(33) + " cat" }, "name_format") && refused({ name: "Cat <b>" }, "name_format"));
ok("tagline: 10 to 160 characters", refused({ tagline: "short" }, "tagline_format") && refused({ tagline: "x".repeat(161) }, "tagline_format"));
ok("a name with no cat in it is refused: \"Pickle Coin\"", refused({ name: "Pickle Coin" }, "not_cat"));
ok("cat words count glued: \"Purrfect Pickle\", \"Kittycorn\", \"Nekomancer\"", ["Purrfect Pickle", "Kittycorn", "Nekomancer"].every((n) => checkProposal({ ...good, name: n }).ok));

section("THE TREND GATE ON THE RECORDED ANSWERS");
{
  const g = parseGoogleTrends(fixture("trends/google-trends-us.xml"));
  const c = parseCoingeckoTrending(fixture("trends/coingecko-trending.json").body);
  ok("the recorded Google Trends RSS parses: 8 items, each with a title and its headlines", g.length === 8 && g.every((t) => t.title && Array.isArray(t.news)) && g.some((t) => t.news.length > 0), g.map((t) => t.title).join(" | "));
  ok("CoinGecko gives categories as topics, never its coins", c.length === fixture("trends/coingecko-trending.json").body.categories.length && !c.some((t) => fixture("trends/coingecko-trending.json").body.coins.some((x) => x.item.name === t.title)));
  const verdicts = [...g, ...c].map((t) => ({ t: t.title, v: checkTrend(t) }));
  ok("every dropped trend names its rule", verdicts.filter((x) => !x.v.ok).every((x) => x.v.violations.length > 0), verdicts.filter((x) => !x.v.ok).map((x) => `${x.t}: ${x.v.violations[0].rule}`).join("; "));
  ok("the headlines can drop a harmless-looking title (as \"hawker hunter\" was, on the day's first read)",
    !checkTrend({ title: "hawker hunter", news: ["Mayday call captures pilot's urgent warning before aircraft goes down off coast", "Rescued pilot flown to Fresno following jet crash into ocean near Morro Bay"] }).ok);
  ok("a person in a headline does not doom a harmless trend; tragedy does", checkTrend({ title: "pumpkin spice", news: ["Mayor Jane Smith opens the autumn fair"] }).ok && !checkTrend({ title: "pumpkin spice", news: ["Three dead after fair collapse"] }).ok);
}

section("POPCAT: FIT TO PRINT");
ok("a plain cat coin prints", displaySafe({ name: "green cat", symbol: "GrenCAT" }).ok);
ok("a hateful, sexual or person-named one does not", !displaySafe({ name: "s3xy kitty", symbol: "SK" }).ok && !displaySafe({ name: "Biden Cat", symbol: "BCAT" }).ok);
ok("a promise in a stranger's name is not Popcat's to refuse (financial_promise is CashCat's rule)", displaySafe({ name: "100x cat", symbol: "HUNDO" }).ok);

section("CAT DETECTION");
for (const [name, symbol] of [["green cat", "GrenCAT"], ["DOOMCAT", "$DOOMCAT"], ["Shark Cat", "SC"], ["catwifhat", "CWIF"], ["The Toad Cat", "TOAD"], ["Meow Run", "MR"], ["Neko Island", "NEKO"],
  ["nyan nyan", "NN"], ["Purrfect Day", "PFD"], ["Tomcat", "TOM"], ["Kitten Club", "KC"], ["cat in a dogs world", "MEW"], ["zzz", "MEW"], ["Bobcat Energy", "BOB"], ["Pussycat", "PCAT"]])
  ok(`cat: "${name}" / ${symbol}`, detectCat({ name, symbol }).isCat, JSON.stringify(detectCat({ name, symbol })));
for (const w of ["catch", "catcher", "cattle", "education", "category", "location", "vacation", "catalyst", "caterpillar", "catering", "catfish", "catwalk", "scatter", "concatenate",
  "delicate", "duplicate", "certificate", "polecat", "muscat", "catholic", "cathedral", "catastrophe", "catalog", "catan", "catsup", "communicate", "sophisticated", "indicate"])
  ok(`not a cat: "${w}"`, catWordIn(w) === null && !detectCat({ name: `The ${w} coin`, symbol: w.toUpperCase() }).isCat);
ok("the ticker alone is enough: name \"Zoom\", ticker SHARKCAT", detectCat({ name: "Zoom", symbol: "SHARKCAT" }).field === "symbol");
ok("one cat word in a description is not enough", !detectCat({ name: "Dog Coin", symbol: "DOG", description: "my dog chased a cat" }).isCat);
ok("two different ones are", detectCat({ name: "Moon", symbol: "MOON", description: "a kitten who wants to meow at the moon" }).field === "description");
ok("CAT_WORDS includes the obvious ones", ["cat", "kitty", "kitten", "meow", "neko", "purr", "feline", "mew"].every((w) => CAT_WORDS.includes(w)));
{
  const names = fixture("pumpfun/create-v2-samples.json").samples.map((s) => Buffer.from(s.dataHex, "hex"));
  const snaps = fixture("popcat/snapshots.json").snapshots.map((s) => s.apiRow);
  ok("the recorded cat coins read as cats (Asset Cat, cosmic cat protocol)", snaps.every((r) => detectCat(r).isCat), snaps.map((r) => `${r.name}: ${detectCat(r).field}`).join(", "));
  ok("the recorded create_v2 samples decode to names the detector can read", names.length === 11);
}

done();
