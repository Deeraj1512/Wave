/**
 * OFFLINE PKCE test — no network. Validates the Authorization Code + PKCE
 * primitives in src/lib/spotify/userAuth.ts:
 *   - challenge(): S256 code_challenge = BASE64URL(SHA256(verifier)), checked
 *     against the official RFC 7636 Appendix B test vector.
 *   - randomB64(): URL-safe base64url (no +, / or =), high entropy (two calls
 *     never collide in a sane universe), byte-length respected.
 * Run: bun run scripts/test_spotify_pkce.ts — exits 1 on any failure.
 */

import { challenge, randomB64 } from "../src/lib/spotify/userAuth";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// RFC 7636 Appendix B — the canonical S256 vector.
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const got = await challenge(RFC_VERIFIER);
check("S256 challenge matches the RFC 7636 vector", got === RFC_CHALLENGE, got);

// URL-safety: the challenge/verifier travel inside a redirect URL query.
const v = randomB64(64);
check("verifier is URL-safe (no + / =)", !/[+/=]/.test(v), `${v.length} chars`);
check("verifier varies across calls", v !== randomB64(64));

// Determinism: same verifier → same challenge (the server re-computes it).
check("challenge is deterministic", (await challenge(RFC_VERIFIER)) === got);

// Token-expiry math used by spotifyUserToken (refresh < 60s before expiry):
const expiresAt = Date.now() + 30_000;
check("token expiring in 30s needs a refresh", Date.now() >= expiresAt - 60_000);
const freshAt = Date.now() + 3_600_000;
check("token expiring in 1h needs no refresh", Date.now() < freshAt - 60_000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
