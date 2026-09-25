/**
 * A COIN'S METADATA: THE LOGO AND THE JSON DOCUMENT ITS URI POINTS AT, PINNED ON IPFS.
 *
 * pump.fun no longer takes uploads from outside its own site (PumpPortal's documentation says
 * so, read 2026-09-24, and pump.fun's frontend now pins through Pinata itself), and StonkFun
 * leaves the URI to whoever builds the launch. So CashCat pins both files on the public IPFS
 * network through the owner's own Pinata account (PINATA_JWT, a secret): POST
 * https://uploads.pinata.cloud/v3/files, multipart { file, network: "public", name }, bearer
 * token, answering { data: { cid } } — Pinata's documented upload API.
 *
 * The document has the shape pump.fun's own frontend writes (read from its live code):
 *   { name, symbol, description, image, showName: true, createdOn, website }
 * with `website` the agency's floor, where every CashCat launch is listed. No twitter, no
 * telegram: CashCat has none and claims none.
 *
 * NOTHING IS BUILT ON AN UPLOAD THAT WAS NOT READ BACK. After pinning, the document is fetched
 * from https://gateway.pinata.cloud/ipfs/<cid> and must equal, field for field, what was sent,
 * with its image a CID we pinned. Only then is the URI written into a transaction.
 *
 * A DRY RUN UPLOADS NOTHING: it renders the logo, builds the document and uses a placeholder
 * URI of the right length, and says so.
 */
import { URLS, pumpMetadataUri, stonkfunMetadataUri, AGENCY_FLOOR_URL } from "../lib/verified.mjs";

export class MetadataError extends Error {
  constructor(clause, message) { super(message); this.name = "MetadataError"; this.clause = clause; }
}

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,70})$/;

/** The disclosure every CashCat coin carries, word for word. */
export function disclosure({ trendTitle }) {
  return `Launched automatically by CashCat, a bot of the Cat Intelligence Agency (catintelligenceagency.com). `
    + `A cat-themed riff on a trending topic ("${trendTitle}"); not affiliated with, endorsed by or connected to that topic or anyone in it. `
    + `Not financial advice. No roadmap, no team, no promises: most coins like this go nowhere.`;
}

export function buildDocument({ name, symbol, tagline, trendTitle, imageUri, venue }) {
  return {
    name, symbol,
    description: `${tagline} — ${disclosure({ trendTitle })}`,
    image: imageUri,
    showName: true,
    createdOn: venue === "stonkfun" ? "https://www.stonkfun.xyz" : "https://pump.fun",
    website: AGENCY_FLOOR_URL,
  };
}

/**
 * The disclosure a coin launched FROM THE EXTENSION carries. It is the user's coin, not the
 * agency's: it does not say it is from the Cat Intelligence Agency, carries no agency website,
 * and credits the tool only when the user ticks "made with CashCat" (off by default).
 */
export function userDisclosure({ topic, madeWithCashCat = false }) {
  const t = String(topic ?? "").replace(/\s+/g, " ").trim();
  if (!t) throw new MetadataError("no_topic", "a coin names the topic it riffs on, so its disclosure can say it is not affiliated with it");
  return `Not financial advice. Not affiliated with ${t}.${madeWithCashCat === true ? " Made with CashCat." : ""}`;
}

/** The metadata document of a user's coin: pump.fun's shape, no website, no socials. */
export function buildUserDocument({ name, symbol, tagline, topic, imageUri, madeWithCashCat = false }) {
  return {
    name, symbol,
    description: `${tagline} — ${userDisclosure({ topic, madeWithCashCat })}`,
    image: imageUri,
    showName: true,
    createdOn: "https://pump.fun",
  };
}

/** The on-chain URI for a pinned document, per venue (see verified.mjs). */
export const uriFor = (venue, cid) => (venue === "stonkfun" ? stonkfunMetadataUri(cid) : pumpMetadataUri(cid));

async function pin(http, jwt, { bytes, filename, contentType }) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), filename);
  form.append("network", "public");
  form.append("name", filename);
  const r = await http.request(URLS.pinataUpload, { method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: form, timeoutMs: 60_000, retries: 1 });
  let body = null;
  try { body = JSON.parse(r.body.toString("utf8")); } catch { body = null; }
  if (!r.ok) throw new MetadataError(r.status === 401 || r.status === 403 ? "pinata_auth" : "pinata_http", `Pinata answered ${r.status}`);
  const cid = body?.data?.cid;
  if (typeof cid !== "string" || !CID.test(cid)) throw new MetadataError("pinata_answer", "Pinata's answer carries no CID");
  return cid;
}

/**
 * Pin the logo and the document, read the document back, and return { uri, imageCid,
 * documentCid, document }. Throws MetadataError on any mismatch. The JWT goes in one header, to
 * Pinata's upload API and nowhere else: the read-back is a keyless request to the public gateway.
 */
export async function pinMetadata({ http, jwt, logoPng, coin, venue, buildDoc = null }) {
  if (typeof jwt !== "string" || !jwt) throw new MetadataError("no_pinata", "PINATA_JWT is not set");
  const imageCid = await pin(http, jwt, { bytes: logoPng, filename: `${coin.symbol.toLowerCase()}.png`, contentType: "image/png" });
  /* The bot's document by default; the extension passes buildUserDocument for a user's coin. */
  const document = buildDoc ? buildDoc({ imageUri: uriFor(venue, imageCid) }) : buildDocument({ ...coin, imageUri: uriFor(venue, imageCid), venue });
  const documentCid = await pin(http, jwt, { bytes: Buffer.from(JSON.stringify(document)), filename: `${coin.symbol.toLowerCase()}.json`, contentType: "application/json" });
  const back = await http.json(URLS.pinataGateway(documentCid), { timeoutMs: 60_000 });
  for (const k of Object.keys(document)) {
    if (JSON.stringify(back?.[k]) !== JSON.stringify(document[k])) throw new MetadataError("read_back", `the pinned document's "${k}" does not read back as sent`);
  }
  const uri = uriFor(venue, documentCid);
  if (uri.length > 200) throw new MetadataError("uri", "the metadata URI is too long for the venue");
  return { uri, imageCid, documentCid, document };
}

/** What a dry run uses instead: nothing is uploaded, and the URI says it is a placeholder. */
export function dryRunMetadata({ coin, venue }) {
  const document = buildDocument({ ...coin, imageUri: "https://ipfs.io/ipfs/(not uploaded in a dry run)", venue });
  /* The length of a real CIDv1 URI, so the simulated transaction is the size a live one is. */
  const placeholderCid = `bafkrei${"a".repeat(52)}`;
  return { uri: uriFor(venue, placeholderCid), imageCid: null, documentCid: null, document, placeholder: true };
}
