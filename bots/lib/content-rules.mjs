/**
 * THE DETERMINISTIC CONTENT RULES: WHAT NEITHER BOT WILL PUT ITS NAME TO.
 *
 * CashCat's coin (name, ticker, tagline, and the trend it riffs on) must pass every rule
 * here AND a separate model review (cashcat/invent.mjs); either one refusing is a refusal.
 * Popcat runs the same rules over a third-party coin's name and ticker before the agency's
 * website shows it, because the site would otherwise print whatever a stranger typed.
 *
 * The rules, each a named clause:
 *   real_person      a name on the famous-people list, or "Firstname Lastname" with a common
 *                    first name; a trend's title meets the long given-name list (given-names.mjs)
 *   brand            a brand, trademark, franchise or well-known character
 *   endorsement      anything that claims or implies being official, endorsed, a partner…
 *   tragedy          disasters, deaths, violence, war, crime, accidents, disease
 *   minors           children and anything about them
 *   sexual           sexual content
 *   hate             extremist terms in plain text, and slurs by salted hash only (the
 *                    repository never spells one out)
 *   identity         a religion, ethnicity, nationality or sexual identity: a coin named for a
 *                    group of people is how hateful coins are usually named
 *   politics         parties, offices, elections: a bot's coin on one reads as taking a side
 *   financial_promise  guaranteed returns, profit, risk-free
 *   link             a web address (a scheme, www., t.me/, or a name with a web ending such as
 *                    .com or .fun): the site prints names as text, never a stranger's link
 *   ticker_format    2–10 characters, A–Z and 0–9 only
 *   not_cat          a CashCat coin must be a cat: its name must carry a cat word
 *
 * Matching is on normalized words (Unicode NFKC, invisible characters removed, accents
 * stripped, Cyrillic and Greek look-alikes and Latin small capitals read as the Latin letters
 * they imitate, lower case, common look-alike digits read as letters), on compounds —
 * "TrumpCat" is "trump" + "cat" and is refused; "trumpet" is not — on letters spelt out one by
 * one ("M.U.S.K.") and on a listed word split in two ("Cat Girl"); and each field is also read as
 * whole words, apostrophes dropped and camelCase not split, so a brand spelt with a capital inside
 * ("SpaceX", "OpenAI", "JPMorgan") or an apostrophe ("McDonald's") is caught. A list can never be
 * complete; that is why the model reviews too, and why the lists err toward refusing.
 */
import { createHash } from "node:crypto";
import { CAT_WORDS } from "./catdetect.mjs";
import { GIVEN_NAMES_TEXT } from "./given-names.mjs";

const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
/** Characters that draw nothing: format characters (zero-width space and joiners, the soft
 *  hyphen, direction marks, the byte-order mark) and the Hangul fillers. Removed, not turned
 *  into spaces, so "Tr\u200Bump" is read as "trump". */
const INVISIBLE = /[\p{Cf}\u115F\u1160\u3164\uFFA0]/gu;
/** Letters of other scripts that look like Latin ones, and Latin small capitals. */
const LOOKALIKE = Object.freeze(Object.fromEntries([
  ["АВЕКМНОРСТУХЅІЈ", "ABEKMHOPCTYXSIJ"], ["авекмнорстухѕіјһԁӏԛԝп", "abekmhopctyxsijhdlqwn"],
  ["ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ", "ABEZHIKMNOPTYX"], ["αβεικνορτυχγω", "abeiknoptuxyw"],
  ["ᴀʙᴄᴅᴇғɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢ", "abcdefghijklmnoprstuvwyz"],
].flatMap(([from, to]) => [...from].map((c, i) => [c, to[i]]))));
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKE).join("")}]`, "gu");

/** NFKC, invisibles removed, accents stripped, look-alikes read as letters, lower case,
 *  separators → spaces. */
export function normalize(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .normalize("NFD").replace(/\p{M}+/gu, "")
    .replace(LOOKALIKE_RE, (c) => LOOKALIKE[c])
    .toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c])
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Words, with camelCase split first ("DoomCat" → doom cat) so compounds are seen, plus the
 *  word that letters spelt out one at a time make ("M.U.S.K." → musk). */
export function wordsOf(text) {
  const split = String(text ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const words = normalize(split).split(" ").filter(Boolean);
  const spelt = [];
  for (let i = 0; i < words.length;) {
    let j = i;
    while (j < words.length && words[j].length === 1) j++;
    if (j - i >= 2) spelt.push(words.slice(i, j).join(""));
    i = j > i ? j : i + 1;
  }
  return [...words, ...spelt];
}

/** Affixes a meme name glues onto a word: "trumpcat", "babymusk", "elonwifhat". */
const AFFIXES = new Set([...CAT_WORDS, "", "s", "wif", "wifhat", "hat", "inu", "coin", "token", "sol", "the", "baby", "mini", "mega", "super", "king", "queen", "lord", "ai", "x", "fi", "dao", "og", "real", "official", "mr", "mrs", "lil", "big", "fat", "dog", "doge", "pepe"]);

/** The endings a nickname puts on a person's name: "trumpy", "muskie", "elonney". */
const NICKNAME = ["y", "ie", "ey"];

function wordHits(words, term, { person = false } = {}) {
  if (term.includes(" ")) {
    const joined = ` ${words.join(" ")} `;
    const compact = words.join("");
    return joined.includes(` ${term} `) || compact.includes(term.replace(/ /g, ""));
  }
  return words.some((w, i) => w === term
    || (w.startsWith(term) && AFFIXES.has(w.slice(term.length)))
    || (w.endsWith(term) && AFFIXES.has(w.slice(0, w.length - term.length)))
    || (person && NICKNAME.some((n) => w === term + n))
    /* A listed word split in two ("cat girl"), both halves words of three letters or more, so
       "cat's hot" is not "shot" and "it is is" is not a group's name. */
    || (w.length >= 3 && words[i + 1]?.length >= 3 && w + words[i + 1] === term));
}

/** A web address in raw text: a scheme, www., t.me/, or a word followed by a web ending. */
const LINKISH = /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\bt\.me\/|\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|xyz|fun|app|me|gg|so|co|ai|tv|ly|to|link|site|online|finance|money|meme|lol|cc|us|info|club|pro|dev|sol|bet|vip|top|live|world|cash|exchange)\b/i;

/* ── the lists ──────────────────────────────────────────────────────────────────────────── */

export const FAMOUS_PEOPLE = Object.freeze([
  "trump", "donald trump", "biden", "joe biden", "obama", "kamala", "vance", "pence", "desantis", "newsom", "clinton",
  "putin", "zelensky", "zelenskyy", "xi jinping", "jinping", "modi", "netanyahu", "erdogan", "macron", "starmer", "trudeau", "milei", "bukele", "kim jong",
  "elon", "musk", "bezos", "zuckerberg", "zuck", "bill gates", "altman", "sam altman", "jensen huang", "tim cook", "nadella", "pichai", "steve jobs",
  "vitalik", "buterin", "saylor", "sbf", "bankman", "cz", "changpeng", "do kwon", "gensler", "yakovenko", "brian armstrong",
  "taylor swift", "kanye", "drake", "beyonce", "rihanna", "kardashian", "kim kardashian", "jenner", "bieber", "eminem", "snoop dogg",
  "mrbeast", "mr beast", "logan paul", "jake paul", "andrew tate", "pewdiepie", "ishowspeed", "kai cenat", "hawk tuah",
  "messi", "ronaldo", "lebron", "michael jordan", "mahomes", "kelce", "ohtani", "neymar", "mbappe",
  "tom brady", "kylie jenner", "meghan markle", "tswift", "pope", "king charles", "queen elizabeth", "prince harry", "epstein", "diddy", "p diddy",
]);

/** Common given names, for the "Firstname Lastname" rule. */
export const FIRST_NAMES = Object.freeze(new Set(("james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony mark donald " +
  "steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott " +
  "brandon benjamin samuel gregory alexander frank patrick raymond jack dennis jerry tyler aaron jose adam nathan henry douglas zachary peter kyle noah ethan " +
  "jeremy walter christian keith roger terry austin sean gerald carl harold dylan arthur lawrence jordan jesse bryan billy bruce gabriel joe logan albert " +
  "willie alan eugene russell vincent philip bobby johnny bradley roy ralph randy louis harry wayne liam elijah lucas mason oliver sebastian owen caleb " +
  "isaac luke jayden julian levi hunter connor landon cameron colton evan elon bill steve tim sam jeff kanye kim " +
  "mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily donna michelle carol " +
  "amanda dorothy melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen samantha katherine " +
  "christine debra rachel carolyn janet catherine maria heather diane ruth julie olivia joyce virginia victoria kelly lauren christina joan evelyn judith " +
  "megan andrea cheryl hannah jacqueline martha gloria teresa ann sara madison frances kathryn janice jean abigail alice judy sophia grace denise amber " +
  "doris marilyn danielle beverly isabella theresa diana natalie brittany charlotte marie kayla alexis lori taylor kamala hillary melania ivanka greta " +
  "alejandro carlos juan luis jorge miguel pedro diego javier antonio manuel francisco rafael fernando sergio ricardo eduardo andres pablo santiago mateo lionel cristiano " +
  "sofia valentina camila lucia mariana gabriela daniela carmen rosa ana pilar marta elena " +
  "cliff clint dwayne travis cody shane dustin chad brett troy derek todd craig marcus darius tyrone jamal andre lamar malik " +
  "mohammed muhammad ahmed ali omar hassan yusuf fatima aisha priya raj rahul arjun wei li ming hiroshi kenji yuki " +
  "vladimir dmitri ivan sergei olga natasha hans klaus fritz pierre jean francois emmanuel giuseppe luca marco giovanni " +
  /* The short forms people are known by ("Charlie Kirk"), leaving out the ones that are common words (will, max, rob). */
  "charlie chris mike matt tony jake josh jimmy tommy danny ricky joey nate zach luigi").split(" ")));

/** The long list, for trend titles only: every US top-1,000 baby name from 1930 to 2008 (see
 *  given-names.mjs for the source), plus the list above. A trend such as "kirk herbstreit" is a
 *  person, and "kirk" is on no short list. It is too broad for CashCat's own words ("may", "will"
 *  and "hope" are names too), so the proposal rules keep FIRST_NAMES. */
export const GIVEN_NAMES = Object.freeze(new Set([...FIRST_NAMES, ...GIVEN_NAMES_TEXT
  .split("\n").filter((l) => /^[a-z]{3,}$/.test(l))].filter((n) => !CAT_WORDS.includes(n))));

export const BRANDS = Object.freeze([
  "apple", "iphone", "google", "alphabet", "youtube", "amazon", "microsoft", "windows", "meta", "facebook", "instagram", "whatsapp", "tiktok", "bytedance", "twitter", "snapchat", "reddit", "discord", "telegram",
  "tesla", "spacex", "starlink", "neuralink", "openai", "chatgpt", "anthropic", "gemini", "nvidia", "intel", "amd", "samsung", "sony", "playstation", "xbox", "nintendo", "sega", "valve", "steam",
  "disney", "pixar", "marvel", "dc comics", "star wars", "netflix", "hbo", "warner", "paramount", "dreamworks", "hasbro", "mattel", "barbie", "lego",
  "pokemon", "pikachu", "hello kitty", "sanrio", "garfield", "felix the cat", "tom and jerry", "doraemon", "pusheen", "nyan cat", "grumpy cat", "keyboard cat", "maru", "lil bub",
  "mickey", "minnie", "sonic", "mario", "zelda", "minecraft", "fortnite", "roblox", "spongebob", "simpsons", "shrek", "catwoman", "thundercats", "sailor moon",
  "nike", "adidas", "gucci", "prada", "louis vuitton", "chanel", "rolex", "coca cola", "cocacola", "coke", "pepsi", "redbull", "red bull", "monster energy",
  "mcdonalds", "burger king", "wendys", "kfc", "starbucks", "dominos", "chipotle", "walmart", "costco", "target", "ikea", "uber", "lyft", "airbnb", "doordash",
  "visa", "mastercard", "paypal", "venmo", "cashapp", "cash app", "robinhood", "gamestop", "blackrock", "vanguard", "jpmorgan", "goldman",
  "coinbase", "binance", "kraken", "okx", "bybit", "phantom", "solflare", "jupiter", "raydium", "pumpfun", "pump fun", "stonkfun", "dexscreener", "coingecko", "coinmarketcap",
  "bitcoin", "ethereum", "solana", "dogecoin", "shiba", "bonk", "popcat", "mew", "michi", "catwifhat", "dogwifhat", "pepe", "wojak",
  "nfl", "nba", "mlb", "nhl", "fifa", "uefa", "olympics", "super bowl", "superbowl", "wwe", "ufc", "formula 1", "ferrari", "lamborghini", "porsche", "bmw", "mercedes", "toyota", "ford",
  "fox news", "cnn", "nytimes", "bbc", "espn", "spotify", "grammy", "oscars",
  /* Major-league team names are trademarks and fill the trend feeds; plurals and distinctive names only. */
  "sox", "white sox", "red sox", "yankees", "dodgers", "mets", "cubs", "astros", "braves", "phillies", "padres", "mariners", "orioles", "guardians", "brewers", "rockies", "diamondbacks",
  "packers", "cowboys", "steelers", "patriots", "chiefs", "eagles", "49ers", "niners", "seahawks", "broncos", "raiders", "chargers", "dolphins", "bengals", "ravens", "vikings", "texans", "titans",
  "colts", "commanders", "buccaneers", "falcons", "saints", "panthers", "jaguars", "lions", "bears", "rams", "cardinals", "browns", "giants", "jets", "bills",
  "lakers", "celtics", "knicks", "warriors", "bulls", "nets", "cavaliers", "cavs", "mavericks", "mavs", "nuggets", "timberwolves", "clippers", "spurs", "rockets", "raptors", "grizzlies", "pelicans", "pacers", "pistons", "hornets", "blazers", "trail blazers",
  "bruins", "canadiens", "maple leafs", "penguins", "blackhawks", "oilers", "flyers", "capitals", "avalanche", "lightning", "canucks", "senators", "sabres", "islanders", "predators", "golden knights",
]);

export const ENDORSEMENT = Object.freeze(["official", "officially", "endorsed", "endorse", "endorses", "endorsement", "partner", "partners", "partnered", "partnership",
  "sponsor", "sponsored", "licensed", "authorized", "authorised", "certified", "verified", "affiliated", "approved", "foundation", "labs", "inc", "llc", "ltd", "corp", "the real",
  "oficial", "authentic", "genuine", "legit", "legitimate"]);

export const TRAGEDY = Object.freeze(["crash", "crashes", "crashed", "plane crash", "mayday", "plunge", "plunges", "die", "dies", "died", "dead", "death", "deaths", "deadly", "dying", "kill", "killed", "kills", "killing", "killer",
  "murder", "murdered", "shooting", "shooter", "shot", "gunman", "gun", "guns", "stab", "stabbing", "stabbed", "bomb", "bombing", "explosion", "attack", "attacked", "terror", "terrorist", "terrorism",
  "war", "wars", "invasion", "missile", "airstrike", "massacre", "genocide", "hostage", "kidnap", "kidnapped", "hurricane", "earthquake", "tsunami", "flood", "floods", "flooding", "wildfire", "wildfires", "tornado", "cyclone", "typhoon",
  "disaster", "tragedy", "tragic", "victim", "victims", "funeral", "obituary", "rip", "memorial", "mourn", "mourning", "suicide", "overdose", "fentanyl", "drowned", "collapse", "collapsed", "derail", "derailed",
  "pandemic", "epidemic", "outbreak", "virus", "cancer", "famine", "riot", "riots", "arrested", "trial", "sentenced", "prison", "abuse", "assault", "injured", "casualties", "evacuate", "evacuation", "emergency",
  "9/11", "twin towers", "assassin", "assassins", "assassinate", "assassinated", "assassination"]);

export const MINORS = Object.freeze(["child", "children", "kid", "kids", "minor", "minors", "teen", "teens", "teenager", "underage", "toddler", "infant", "schoolgirl", "schoolboy", "preteen", "school", "student", "students", "daycare", "loli", "shota"]);

export const SEXUAL = Object.freeze(["sex", "sexy", "sexual", "porn", "porno", "nude", "nudes", "naked", "nsfw", "xxx", "onlyfans", "horny", "boob", "boobs", "tits", "titties", "dick", "cock", "pussy", "penis", "vagina", "anal", "cum", "milf", "hentai", "fetish", "stripper", "escort", "orgasm", "erotic", "thot", "nipple", "nipples", "bdsm", "catgirl", "yiff", "thicc", "lewd"]);

export const HATE_PLAIN = Object.freeze(["nazi", "nazis", "hitler", "heil", "kkk", "swastika", "white power", "1488", "isis", "jihad", "holocaust", "fascist", "supremacist", "racist", "racism", "slave", "slavery", "lynch", "lynching",
  "neonazi", "neo nazi", "hamas", "hezbollah", "taliban", "al qaeda", "alqaeda", "jihadi", "jihadis", "jihadist", "jihadists", "proud boys"]);

/** Salted sha256 of slurs, first 20 hex. The words are never written in this repository. */
export const HATE_HASHES = Object.freeze(new Set(["e2eb6e68e91314de85c7", "f1647cbfc8500de7b21b", "69cb8461ee3acca1f695", "f525aa147446d5684560", "07e686f90ef394a0e854", "d610612e0543591b8d89",
  "051e2a44ef03b42eb6ff", "25777da45145b735adbf", "e8b6edf7bec05a413791", "be7bd6f19b471306b5a1", "51803cee75cc6f8e109b", "4209e3be1cd18b882e98", "51afabd232ae8c0becdf", "63f375904127e12696fe",
  "435f3d86e0af4118de5a", "233b1c12856d09088da3", "b013754bafd1627d2610", "602c2b16b519ada296c1", "5dfd5548a9288a4cda67", "0d8bc22390791fb88f7b", "bd7a67c7a6bbdc11879a", "608855b674b953e95ce9",
  "de494a805c8d7fd19acc", "94f09500ef6e05479e9a", "251e2502852a6aba69df", "be10412dcc73ec8b367a", "2279e8836962fe3bfe7e", "c20b51a71e5a45148e0a", "ffa5d2a4e9a1160dde6e", "9d6b16a25332c59b47cf",
  "89d972cf3806bc2893ae", "15c135580a04c2fe4a41", "d492597ef4174f22546e", "6956b04bfaf9bed877d7", "b91d0e5976abf43c7e44", "38b98b17e7f8963c2879", "916f99688ddb3b523839"]));
export const hashTerm = (word) => createHash("sha256").update("cia-bots:" + word).digest("hex").slice(0, 20);

/** Politics: parties, offices, elections, and the countries at war. A bot's coin on one reads as taking a side. */
export const POLITICS = Object.freeze(["politics", "political", "election", "elections", "vote", "voting", "ballot", "president", "presidential", "congress", "senate", "senator",
  "governor", "democrat", "democrats", "republican", "republicans", "gop", "maga", "parliament", "prime minister", "campaign", "impeachment", "tariff", "tariffs",
  "gaza", "west bank", "palestine", "israel", "ukraine", "russia", "iran"]);

/** Religions, ethnicities, nationalities and sexual identities: a meme coin named for a group of
 *  people is how most hateful coins are named, so neither bot puts its name to one. */
export const IDENTITY = Object.freeze(["jew", "jews", "jewish", "muslim", "muslims", "islam", "islamic", "christian", "christians", "hindu", "hindus", "sikh", "buddhist",
  "arab", "arabs", "mexican", "mexicans", "chinese", "japanese", "korean", "asian", "asians", "african", "africans", "indian", "indians", "latino", "latina", "hispanic",
  "gay", "gays", "lesbian", "lesbians", "trans", "transgender", "queer", "lgbt", "lgbtq", "immigrant", "immigrants", "refugee", "refugees", "negro", "gypsy", "gypsies", "palestinian", "israeli", "ukrainian", "russian"]);

export const FINANCIAL_PROMISE = Object.freeze(["guaranteed", "guarantee", "risk free", "riskfree", "profit", "profits", "returns", "passive income", "apy", "100x", "1000x", "x100", "x1000", "financial advice"]);

/* ── the checks ─────────────────────────────────────────────────────────────────────────── */

/* Each term is normalized the way text is ("1488" and "100x" pass through the same look-alike
   mapping), so a term and the text it should catch always meet in the same form. */
const LIST_RULES = Object.freeze([
  ["real_person", FAMOUS_PEOPLE],
  ["brand", BRANDS],
  ["endorsement", ENDORSEMENT],
  ["tragedy", TRAGEDY],
  ["minors", MINORS],
  ["sexual", SEXUAL],
  ["hate", HATE_PLAIN],
  ["identity", IDENTITY],
  ["politics", POLITICS],
  ["financial_promise", FINANCIAL_PROMISE],
].map(([rule, list]) => [rule, list.map((t) => [t, normalize(t)])]));

const NOT_A_SURNAME = new Set([...CAT_WORDS, "the", "and", "of", "is", "in", "on", "wif", "with", "a", "an", "to", "coin", "token", "day", "night", "season", "time", "world", "vs", "fc", "cup"]);

/** "Firstname Lastname": a common given name followed by another word that is not a cat or filler word. */
function personNameHit(words) {
  for (let i = 0; i + 1 < words.length; i++) {
    const [a, b] = [words[i], words[i + 1]];
    if (FIRST_NAMES.has(a) && /^[a-z]{3,}$/.test(b) && !NOT_A_SURNAME.has(b) && !FIRST_NAMES.has(b)) return `${a} ${b}`;
  }
  return null;
}

/**
 * The two readings of one field a listed term is matched against.
 *
 * `split` is wordsOf: camelCase split, so "TrumpCat" is "trump" + "cat". `whole` is the same
 * text with its apostrophes dropped and camelCase NOT split. Both are needed, because splitting
 * breaks the brands whose own spelling carries a capital inside the word: "SpaceX" splits into
 * "space" + "x", "OpenAI" into "open" + "ai", "JPMorgan" into "jp" + "morgan", and a half of one
 * or two letters is too short for the split-word rule to rejoin (that rule wants both halves three
 * letters or longer, so "cat's hot" never reads as "shot"). An apostrophe splits too:
 * "McDonald's" was "mcdonald" + "s". Every one of those four passed checkFields until 2026-09-25,
 * and SPCXx (SpaceX) and MCDx (McDonald's) are stocks a stock cat can be paired with, so the gap
 * was a way to name a coin for the company behind its pair. Reading the whole words as well
 * closes it; CashCat, the bot and Popcat share this file, so all three are fixed at once.
 */
function readings(value) {
  const split = wordsOf(value);
  const whole = normalize(String(value ?? "").replace(/['\u2019]/g, "")).split(" ").filter(Boolean);
  return { split, whole };
}
const readingHits = ({ split, whole }, norm, opts) => wordHits(split, norm, opts) || wordHits(whole, norm, opts);

/**
 * Run the list rules over labelled fields. Returns { ok, violations: [{ rule, term, field }] }.
 * `skip` names rules not to apply to these fields.
 */
export function checkFields(fields, { skip = [] } = {}) {
  const violations = [];
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    const read = readings(value);
    const words = read.split;
    for (const [rule, list] of LIST_RULES) {
      if (skip.includes(rule)) continue;
      for (const [term, norm] of list) if (readingHits(read, norm, { person: rule === "real_person" })) { violations.push({ rule, term, field }); break; }
    }
    if (!skip.includes("real_person")) {
      const hit = personNameHit(words);
      if (hit) violations.push({ rule: "real_person", term: hit, field });
    }
    if (!skip.includes("hate")) {
      const hashed = words.find((w) => HATE_HASHES.has(hashTerm(w)) || [...AFFIXES].some((a) => a && w.endsWith(a) && HATE_HASHES.has(hashTerm(w.slice(0, w.length - a.length)))));
      if (hashed) violations.push({ rule: "hate", term: "[a slur]", field });
    }
    if (!skip.includes("link")) {
      const m = String(value).normalize("NFKC").replace(INVISIBLE, "").match(LINKISH);
      if (m) violations.push({ rule: "link", term: m[0], field });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * The same matching, over lists the caller brings: { [rule]: terms[] }. Stock cats use it for the
 * words of the stock a coin is paired with (its symbol, its root ticker, the words of its name,
 * and the people, mascots and brands the research row sourced), so a pair's own terms are held to
 * exactly the compounds, look-alikes, spelt-out letters and split words the fixed lists are.
 * Returns { ok, violations: [{ rule, term, field }] }; one violation per rule and field, the first
 * term that hit.
 */
export function checkTerms(fields, lists) {
  const violations = [];
  const prepared = Object.entries(lists ?? {}).map(([rule, terms]) => [rule, [...new Set((terms ?? []).map((t) => String(t ?? "")))]
    .map((t) => [t, normalize(t)]).filter(([, n]) => n.length > 0)]);
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    const read = readings(value);
    for (const [rule, list] of prepared) {
      for (const [term, norm] of list) if (readingHits(read, norm)) { violations.push({ rule, term, field }); break; }
    }
  }
  return { ok: violations.length === 0, violations };
}

export const TICKER = /^[A-Z0-9]{2,10}$/;
/** A letter of any script but Latin: CashCat's coins are named and described in the Latin alphabet only. */
const NOT_LATIN = /(?=\p{L})\P{Script=Latin}/u;

/** CashCat's proposal, before the model review and the ticker check against Jupiter. */
export function checkProposal({ name, symbol, tagline, trend }) {
  const { violations } = checkFields({ name, symbol, tagline, trend });
  if (typeof symbol !== "string" || !TICKER.test(symbol)) violations.push({ rule: "ticker_format", term: String(symbol), field: "symbol" });
  if (typeof name !== "string" || name.trim().length < 3 || name.length > 32 || /[^\p{L}\p{N} '\-.!&]/u.test(name) || NOT_LATIN.test(name.normalize("NFKC"))) violations.push({ rule: "name_format", term: String(name).slice(0, 40), field: "name" });
  if (typeof tagline !== "string" || tagline.trim().length < 10 || tagline.length > 160 || /[\p{Cc}\p{Cf}]/u.test(tagline) || NOT_LATIN.test(tagline.normalize("NFKC"))) violations.push({ rule: "tagline_format", term: String(tagline).slice(0, 40), field: "tagline" });
  if (!wordsOf(name).some((w) => CAT_WORDS.includes(w) || CAT_WORDS.some((c) => c.length >= 3 && (w.startsWith(c) || w.endsWith(c)) && w.length <= c.length + 12))) violations.push({ rule: "not_cat", term: String(name), field: "name" });
  return { ok: violations.length === 0, violations };
}

/**
 * Is this trend something CashCat may riff on at all? The trend's own title and the news
 * headlines that came with it are checked for tragedy, people, brands, minors, sex and hate:
 * "hawker hunter" reads harmless until its headlines say a jet went into the sea.
 */
export function checkTrend({ title, news = [] }) {
  const a = checkFields({ trend: title });
  /* A trend named for a person is dropped even when the name is on no list: any given name from
     the long list followed by another word ("kirk herbstreit", "josh allen", "travis scott").
     Unlike personNameHit, the second word may be a given name too. Erring this way costs a trend,
     never a coin. */
  const words = wordsOf(title);
  for (let i = 0; i + 1 < words.length && !a.violations.some((v) => v.rule === "real_person"); i++) {
    if (GIVEN_NAMES.has(words[i]) && /^[a-z]{3,}$/.test(words[i + 1]) && !NOT_A_SURNAME.has(words[i + 1])) {
      a.violations.push({ rule: "real_person", term: `${words[i]} ${words[i + 1]}`, field: "trend" }); a.ok = false; break;
    }
  }
  const b = checkFields(Object.fromEntries(news.slice(0, 6).map((t, i) => [`news ${i + 1}`, t])), { skip: ["endorsement", "financial_promise", "real_person", "brand", "politics", "link"] });
  /* People, brands and politics in a headline do not doom a trend ("Mayor opens a cat café" is fine);
     tragedy, minors, sex and hate in one do. The trend title itself gets every rule. */
  return { ok: a.ok && b.ok, violations: [...a.violations, ...b.violations] };
}

/** What Popcat checks before the agency's site shows a stranger's coin name and ticker. */
export function displaySafe({ name, symbol }) {
  return checkFields({ name, symbol }, { skip: ["financial_promise"] });
}
