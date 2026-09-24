/**
 * THE BOTS' ONLY WAY TO PRINT, AND IT NEVER PRINTS A SECRET.
 *
 * Every line either bot writes goes through a logger made here. The logger is handed the
 * secrets of the run (the API key, the wallet secret, the RPC URL — which usually carries a
 * provider key in its path or query — and the Pinata token) and replaces each of them, and
 * any 64-number byte array (the shape of a keypair file), before a byte reaches stdout.
 * GitHub Actions masks registered secrets too; this does not rely on it, and it also covers
 * a local run.
 *
 * The logger also never prints an object as-is: values are rendered with JSON.stringify and
 * then scrubbed, so a secret inside a nested error message is caught the same way.
 */

const MIN_SECRET_LENGTH = 6;
/* A 64-byte secret key in base58 is 86–88 characters, exactly the length of a transaction
   signature, so no length rule can tell them apart without hiding every signature the owner
   needs to see. The wallet secret is therefore redacted by value (it is one of `secrets`),
   and wallet.mjs never hands its bytes to anything that prints. */
/** A JSON byte array of 64 numbers is how a Solana keypair file looks. */
const KEY_ARRAY = /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g;

export function makeRedactor(secrets = []) {
  const list = secrets
    .filter((s) => typeof s === "string" && s.length >= MIN_SECRET_LENGTH)
    .flatMap((s) => {
      const out = [s];
      /* The URL form of a secret, and the parts of an RPC URL that carry its key. */
      try {
        const u = new URL(s);
        if (u.search.length > 3) out.push(u.search.slice(1));
        for (const v of u.searchParams.values()) if (v.length >= MIN_SECRET_LENGTH) out.push(v);
        for (const part of u.pathname.split("/")) if (part.length >= 16) out.push(part);
        if (u.username) out.push(u.username);
        if (u.password) out.push(u.password);
      } catch { /* not a URL */ }
      return out;
    })
    .sort((a, b) => b.length - a.length);
  return function redact(value) {
    let text = typeof value === "string" ? value : safeStringify(value);
    for (const s of list) text = text.split(s).join("[redacted]");
    text = text.replace(KEY_ARRAY, "[redacted key bytes]");
    return text;
  };
}

function safeStringify(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? `[${v.length} bytes]` : v));
  } catch {
    return String(value);
  }
}

/**
 * A logger: log.info(...), log.warn(...), log.error(...), log.section(title). `sink` is
 * where the scrubbed lines go (console by default; the tests pass an array's push).
 */
export function createLogger({ secrets = [], sink = null, prefix = "" } = {}) {
  const redact = makeRedactor(secrets);
  const lines = [];
  const out = sink ?? ((level, line) => (level === "error" || level === "warn" ? console.error(line) : console.log(line)));
  const emit = (level, parts) => {
    const line = redact(prefix + parts.map((p) => (typeof p === "string" ? p : safeStringify(p))).join(" "));
    lines.push(line);
    out(level, line);
  };
  return Object.freeze({
    info: (...p) => emit("info", p),
    warn: (...p) => emit("warn", ["WARN", ...p]),
    error: (...p) => emit("error", ["ERROR", ...p]),
    section: (title) => emit("info", [`\n== ${title} ==`]),
    redact,
    lines,
  });
}

/** The secrets of a run, read from the environment by name. Values never leave this module
 *  except into a redactor. */
export const SECRET_ENV_NAMES = Object.freeze(["ANTHROPIC_API_KEY", "CASHCAT_WALLET_SECRET", "SOLANA_RPC_URL", "PINATA_JWT", "GH_TOKEN", "GITHUB_TOKEN"]);
export const secretsFromEnv = (env = process.env) => SECRET_ENV_NAMES.map((n) => env[n]).filter((v) => typeof v === "string" && v.length > 0);
