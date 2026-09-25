#!/usr/bin/env node
/**
 * SIGN AN ADMIN COMMAND ON THE OWNER'S OWN COMPUTER, AND SEND IT TO HQ.
 *
 *   node services/hq/admin-client.mjs --keypair ~/.config/solana/cia-owner.json \
 *        --url https://api.catintelligenceagency.com --command '{"op":"agent.pause","id":1}'
 *
 * The keypair file is the owner's admin wallet (solana-keygen's 64-number array, or a base58
 * secret in a file) whose address is HQ_OWNER_WALLET on the server. It is read here, on the
 * owner's machine, to sign one message and never sent anywhere: HQ receives the command, a fresh
 * nonce, the time and the signature, and checks the signature against HQ_OWNER_WALLET. Without
 * --url it prints the signed request instead of sending it. The CLI on the server
 * (`railway ssh`, then services/hq/cli.mjs) needs no signature at all.
 */
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { adminMessage } from "./lib/admin.mjs";
import { signOwnerMessage } from "./wallet.mjs";
import { parseArgs } from "./cli.mjs";

/** The request body for one command. Pure but for the clock and the nonce. */
export function signedRequest({ command, keypairPath, now = Date.now(), nonce = crypto.randomBytes(18).toString("base64url") }) {
  const issuedAt = new Date(now).toISOString();
  const { address, signature } = signOwnerMessage({ keypairPath, message: adminMessage({ command, nonce, issuedAt }) });
  return { signer: address, body: { command, nonce, issuedAt, signature } };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (!flags.keypair || !flags.command) { console.error("usage: admin-client.mjs --keypair <file> --command '<json>' [--url https://api.catintelligenceagency.com]"); return 1; }
  let command;
  try { command = JSON.parse(flags.command); } catch { console.error("--command must be JSON, e.g. '{\"op\":\"kill\",\"on\":true}'"); return 1; }
  const { signer, body } = signedRequest({ command, keypairPath: flags.keypair });
  if (!flags.url) { console.log(JSON.stringify({ signer, body }, null, 2)); return 0; }
  const res = await fetch(`${String(flags.url).replace(/\/+$/, "")}/v1/admin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  console.log(res.status, await res.text());
  return res.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c));
