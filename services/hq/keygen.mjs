#!/usr/bin/env node
/**
 * MAKE HQ'S SECRETS, ON THE OWNER'S OWN COMPUTER, AND SHOW THEM ONCE.
 *
 *   node services/hq/keygen.mjs
 *
 * Prints, to this terminal only:
 *   HQ_MASTER_SEED       a new 24-word recovery phrase: every agent wallet derives from it
 *                        (agent N at m/44'/501'/N'/0'; Phantom shows agent N as its account N)
 *   HQ_TREASURY_SECRET   a new treasury wallet's secret key (base58, the form Phantom imports),
 *   HQ_TREASURY_ADDRESS  and its address
 * and the first agents' addresses, so the owner can check them against Phantom.
 *
 * It refuses to run where its output could land in a log: when its output is not a terminal
 * (piped or redirected into a file), in CI, on GitHub Actions, or on a Railway machine. It writes
 * no file and keeps nothing: the secrets exist in this terminal and wherever the owner pastes them
 * (the host's secret variables, and the phrase on paper). The generation itself lives in wallet.mjs,
 * the one file that may hold a key.
 */
import { newRecoveryPhrase, newTreasuryKey, addressFromPhrase, derivationPath } from "./wallet.mjs";

export function refusal(env = process.env, isTTY = process.stdout.isTTY) {
  if (env.CI || env.GITHUB_ACTIONS || env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID) return "this looks like CI or a server: run keygen on your own computer, never where its output is logged";
  if (!isTTY) return "the output is not a terminal (it is piped or written to a file): run it in a terminal window so the secrets appear only there";
  return null;
}

function main() {
  const why = refusal();
  if (why) { console.error(`keygen refused: ${why}.`); process.exit(1); }
  const phrase = newRecoveryPhrase();
  const treasury = newTreasuryKey();
  const line = "─".repeat(78);
  console.log(`${line}
AGENCY HQ SECRETS — shown once. Nothing was saved. Copy them now; then close this window.
${line}

1. HQ_MASTER_SEED  (every agent wallet comes from it; write it on paper too and keep that safe)

${phrase}

2. The treasury wallet (receives agents' fees and profit; funds agents; buys back $CIA)

HQ_TREASURY_ADDRESS=${treasury.address}
HQ_TREASURY_SECRET=${treasury.secretBase58}

   Import HQ_TREASURY_SECRET into Phantom ("Add / Connect Wallet" → "Import Private Key") to
   fund agents from it. Put it into Railway ONLY if you want automatic $CIA buybacks.

3. The first agents' wallets, from this phrase (check them in Phantom if you like):
${[1, 2, 3].map((n) => `   agent ${String(n).padStart(3, "0")}  ${derivationPath(n).padEnd(20)} ${addressFromPhrase({ phrase, path: derivationPath(n) })}`).join("\n")}

Never paste these into a chat, an email, a screenshot, a commit or a file in the repository.
${line}`);
}

if (process.argv[1] && import.meta.url.endsWith("/keygen.mjs") && process.argv[1].endsWith("keygen.mjs")) main();
