/**
 * Supabase credentials — obfuscated, baked into the source bundle.
 *
 *  ⚠️  SECURITY NOTE
 *  ────────────────────────────────────────────────────────────────────
 *  This is OBFUSCATION, not encryption. The salt and algorithm are in
 *  this same bundle, so anyone running the JS can trivially recover
 *  the plaintext (one debugger statement is enough). The only purpose
 *  is to keep credentials from showing up in plain text via grep,
 *  DevTools "Search all files", or casual source viewing.
 *
 *  The actual security boundary is Supabase Row-Level Security policies
 *  defined in supabase/schema.sql. With the publishable key — which is
 *  designed to be public — the worst an attacker can do is read/write
 *  the `workspaces` table, which is exactly what's allowed by design.
 *  ────────────────────────────────────────────────────────────────────
 *
 * To rotate credentials:
 *   npm run obfuscate-credentials -- "<URL>" "<ANON_KEY>"
 * then paste the output ENCODED_URL / ENCODED_KEY back into this file.
 */

// IMPORTANT: this salt MUST match the SALT in scripts/obfuscate-credentials.mjs
const SALT = "pharma-fy26-train-scheduler-9k4j2-anon-publishable-salt";

export const ENCODED_URL =
  "181c15021e5b02490c4a4e5a011f0e1f0b5f1609100a0c171b0608451718411a534f001d0a404e1f";

export const ENCODED_KEY =
  "030a3e021803410f0a5a574f18173e5f0a432631251f0736010c0b77725b551f671f27373e3177270238392a1b2a";

function xorHexDecode(hex: string, salt: string): string {
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const b = parseInt(hex.substr(i, 2), 16);
    out += String.fromCharCode(b ^ salt.charCodeAt((i / 2) % salt.length));
  }
  return out;
}

/**
 * Resolve Supabase credentials with the following priority:
 *
 *   1. Vite env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
 *      — useful for local dev with .env.local; never commit these.
 *   2. Obfuscated baked-in values above.
 *   3. null (Supabase disabled, app falls back to localStorage only).
 */
export function getSupabaseConfig(): { url: string; key: string } | null {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
  if (envUrl && envKey) return { url: envUrl, key: envKey };

  if (!ENCODED_URL || !ENCODED_KEY) return null;
  try {
    return {
      url: xorHexDecode(ENCODED_URL, SALT),
      key: xorHexDecode(ENCODED_KEY, SALT),
    };
  } catch {
    return null;
  }
}
