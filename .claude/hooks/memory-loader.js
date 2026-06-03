// memory-loader.js — fs/glue layer for memory-guard (FRW-BL-069).
//
// PURPOSE: the SINGLE code path that ALL model-loaded persistent memory routes through before
// it reaches any context. Whether it's the HOT tier (session summary + steering rules) wrapped
// by session-start.js, or lessons / patterns / blueprint / journal loaded directly by Volundr,
// every item is wrapped as untrusted DATA (memory-guard.wrapAsData + DATA_PREAMBLE) AND gated
// by the SIGNED integrity manifest (memory-guard.checkIntegritySigned) — not by documentation.
//
// Split of responsibility:
//   - memory-guard.js  = PURE crypto (hash, sign, verify, wrap, checkIntegritySigned). No fs.
//   - memory-loader.js = the fs glue: read the HMAC key (from OUTSIDE VLDR_HOME's write
//     boundary, env VLDR_MEMORY_HMAC_KEY), load/save the signed manifest, and expose
//     wrapAllMemory() — the enforced wrapping entry point.
//
// THREAT MODEL (why the key lives in an env var): the manifest file shares VLDR_HOME's write
// boundary with the lessons it protects. An attacker who can poison a lesson can also rewrite
// the manifest bytes. The HMAC key is NOT in VLDR_HOME — it comes from the process environment
// (set by the operator / launcher). Without it the attacker cannot forge a valid signature, so
// a rewritten manifest fails verifyManifest() → checkIntegritySigned() refuses to auto-approve.
//
// DEGRADE SAFELY: if VLDR_MEMORY_HMAC_KEY is unset we fall back to unsigned TOFU and emit a
// clear warning (signatureRequired=false). We never crash a session and never silently treat
// an unsigned manifest as verified-signed.

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildSafeInjection, wrapAsData, checkIntegritySigned, signManifest,
} = require('./memory-guard');

const HMAC_ENV_VAR = 'VLDR_MEMORY_HMAC_KEY';

function vldrHome() {
  return process.env.VLDR_HOME || path.join(os.homedir(), '.volundr');
}

function manifestPath() {
  return path.join(vldrHome(), 'global', 'memory-approved.json');
}

// Read the HMAC key from the environment ONLY. Deliberately NOT read from any file under
// VLDR_HOME — keeping it outside that write boundary is the whole point (see header). Returns
// null when unset/blank so callers degrade to unsigned TOFU with a warning.
function loadHmacKey() {
  const k = process.env[HMAC_ENV_VAR];
  if (typeof k === 'string' && k.trim().length > 0) return k;
  return null;
}

// Load the on-disk signed manifest. Tolerates: missing file, malformed JSON, legacy bare-entries
// maps (pre-FRW-BL-069 plaintext { "kind:id": "hash" }). Returns the parsed object as-is;
// checkIntegritySigned() decides how to interpret it (envelope vs bare, signed vs not).
function loadSignedManifest() {
  try {
    const raw = fs.readFileSync(manifestPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

// Persist a signed manifest envelope { version, alg, entries, sig }. Best-effort: manifest
// persistence must never crash a session. Returns true on success, false otherwise.
function saveSignedManifest(signed) {
  try {
    const p = manifestPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(signed, null, 2));
    return true;
  } catch {
    return false;
  }
}

// wrapAllMemory(items, opts) — THE enforced code path. Every lesson/pattern/blueprint/journal/
// session-summary/steering-rule item MUST go through here before reaching context.
//
// items: [{ id, content, kind? }]. opts.persist (default true) writes the re-signed manifest
// back so TOFU additions are recorded (and re-signed when a key is present). opts.warn is an
// optional (msg, meta) callback for surfacing the unsigned-degrade / withheld warnings.
//
// Returns { text, trusted, withheld, signatureValid, signatureRequired, signed }.
//   - text: the full injection string — each trusted item fenced as untrusted DATA, plus a
//     quarantine note naming any withheld items.
//   - signatureValid/signatureRequired: provenance of the integrity decision (see memory-guard).
function wrapAllMemory(items, opts = {}) {
  const persist = opts.persist !== false;
  const warn = typeof opts.warn === 'function' ? opts.warn : () => {};
  const list = Array.isArray(items) ? items.filter((i) => i && i.content != null) : [];

  const key = loadHmacKey();
  const onDisk = loadSignedManifest();
  const res = checkIntegritySigned(list, onDisk, key, opts);

  // Surface degrade / rejection state so the operator is never silently mis-served.
  if (!key) {
    warn('memory_unsigned_degrade',
      `${HMAC_ENV_VAR} unset — memory integrity running in UNSIGNED TOFU mode. A poisoned lesson `
      + 'could also rewrite the manifest hash and be auto-approved. Set ' + HMAC_ENV_VAR
      + ' (outside VLDR_HOME) for tamper-proof signed verification.',
      { signatureRequired: false });
  } else if (!res.signatureValid) {
    warn('memory_signature_invalid',
      'Signed manifest verification FAILED (missing/forged signature). Refusing to auto-approve '
      + `${res.withheld.length} memory item(s); they are WITHHELD pending an operator-signed `
      + 're-approval. This is the expected response to a manifest-rewrite attack.',
      { withheld: res.withheld.map((w) => `${w.kind}:${w.id}`).join(',') });
  } else if (res.withheld.length > 0) {
    warn('memory_withheld',
      `Withheld ${res.withheld.length} tampered memory item(s) (hash changed since approval).`,
      { items: res.withheld.map((w) => `${w.kind}:${w.id}`).join(',') });
  }

  // Fence each TRUSTED item as untrusted DATA + append a quarantine note for withheld items.
  const blocks = res.trusted.map((t) => wrapAsData(t.content, { kind: t.kind, id: t.id, nonce: t.hash }));
  let text = blocks.join('\n\n');
  if (res.withheld.length > 0) {
    const reason = (!key)
      ? 'integrity hash changed since approval (possible tampering)'
      : (!res.signatureValid
        ? 'signed-manifest verification FAILED — manifest signature missing/forged (possible rewrite attack)'
        : 'integrity hash changed since approval (possible tampering)');
    text += `\n\n[memory-guard] WITHHELD ${res.withheld.length} memory item(s) — ${reason}: `
      + res.withheld.map((w) => `${w.kind}:${w.id}`).join(', ')
      + '. They are NOT injected; re-approve (write a validly-signed manifest) after review.';
  }

  if (persist) {
    // Persist the re-signed manifest with any TOFU additions in the normal cases (valid
    // signature, empty-baseline bootstrap, or no-key unsigned mode). The ONE case we must NOT
    // overwrite is a detected manifest-REWRITE ATTACK (key present, signature invalid over a
    // NON-empty baseline) — re-signing { } there would clobber the operator's real signed
    // baseline and mask the attack. checkIntegritySigned marks that path with the
    // 'manifest-signature-invalid' withhold reason; detect it precisely so a clean first boot
    // (empty baseline → signatureValid false but NOT an attack) still persists.
    const rewriteAttack = key
      && !res.signatureValid
      && res.withheld.some((w) => w.reason === 'manifest-signature-invalid');
    if (rewriteAttack) {
      // intentionally skip persistence — preserve evidence of the rewrite attempt
    } else {
      saveSignedManifest(res.signed);
    }
  }

  return {
    text,
    trusted: res.trusted,
    withheld: res.withheld,
    signatureValid: res.signatureValid,
    signatureRequired: res.signatureRequired,
    signed: res.signed,
  };
}

// Convenience for callers that already hold a manifest object in memory and just want the
// PURE injection (no fs). Thin pass-through to buildSafeInjection — kept so unsigned callers
// have a single import surface.
function buildSafeInjectionInMemory(items, manifest, opts) {
  return buildSafeInjection(items, manifest, opts);
}

module.exports = {
  loadHmacKey, loadSignedManifest, saveSignedManifest, wrapAllMemory,
  buildSafeInjectionInMemory, manifestPath, signManifest, HMAC_ENV_VAR,
};
