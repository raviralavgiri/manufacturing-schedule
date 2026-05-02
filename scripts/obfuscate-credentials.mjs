#!/usr/bin/env node
/**
 * Obfuscation script for Supabase credentials.
 *
 * Usage:
 *   node scripts/obfuscate-credentials.mjs <SUPABASE_URL> <SUPABASE_ANON_KEY>
 *
 * Or via npm:
 *   npm run obfuscate-credentials -- <URL> <KEY>
 *
 * Outputs the encoded blobs that should be pasted into
 * src/config/supabaseConfig.ts. The runtime decoder uses the same SALT.
 *
 * SECURITY NOTE: this is OBFUSCATION, not encryption. The salt and
 * algorithm are in the bundle, so anyone running the JS can recover the
 * plaintext. The only purpose is to keep credentials out of plain-text
 * grep / DevTools-Sources view. Real security comes from Supabase RLS
 * policies (see supabase/schema.sql), not from this transform.
 */

// IMPORTANT: keep this exact string in sync with src/config/supabaseConfig.ts
const SALT = "pharma-fy26-train-scheduler-9k4j2-anon-publishable-salt";

function xorHexEncode(plain, salt) {
  let out = "";
  for (let i = 0; i < plain.length; i++) {
    const b = plain.charCodeAt(i) ^ salt.charCodeAt(i % salt.length);
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function xorHexDecode(hex, salt) {
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const b = parseInt(hex.substr(i, 2), 16);
    out += String.fromCharCode(b ^ salt.charCodeAt((i / 2) % salt.length));
  }
  return out;
}

const [, , url, key] = process.argv;
if (!url || !key) {
  console.error(
    "Usage: node scripts/obfuscate-credentials.mjs <SUPABASE_URL> <SUPABASE_ANON_KEY>"
  );
  process.exit(1);
}

const encUrl = xorHexEncode(url, SALT);
const encKey = xorHexEncode(key, SALT);

// Self-check: encode -> decode must yield the original strings byte-for-byte.
const dUrl = xorHexDecode(encUrl, SALT);
const dKey = xorHexDecode(encKey, SALT);
if (dUrl !== url) {
  console.error("ERROR: URL round-trip failed:", dUrl, "!=", url);
  process.exit(2);
}
if (dKey !== key) {
  console.error("ERROR: KEY round-trip failed:", dKey, "!=", key);
  process.exit(2);
}

console.log("// === Paste these into src/config/supabaseConfig.ts ===");
console.log("");
console.log(`export const ENCODED_URL =`);
console.log(`  "${encUrl}";`);
console.log("");
console.log(`export const ENCODED_KEY =`);
console.log(`  "${encKey}";`);
console.log("");
console.log("// Round-trip self-check OK ✓");
