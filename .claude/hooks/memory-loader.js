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
//
// FRW-BL-072 — DELETION vector closed. A signature protects manifest REWRITE, not DELETION: an
// attacker with VLDR_HOME write access could DELETE memory-approved.json, forcing the empty-
// baseline bootstrap to re-TOFU whatever (poisoned) content is present. We now anchor "this store
// was initialized" OUTSIDE the VLDR_HOME write boundary via a key-derived INIT MARKER at
// ~/.vldr-mem-init (sibling of ~/.volundr; see initMarkerPath/loadInitMarker/writeInitMarker).
// On boot with a key set and the manifest ABSENT: marker matches => deletion attack => WITHHOLD;
// marker absent => genuine first boot => bootstrap + write the marker. Key-gated: with no key the
// unsigned-TOFU degrade above is preserved unchanged. All home/VLDR_HOME/marker paths + env are
// injectable (opts.env/homeDir/markerPath) so tests never touch real ~/.vldr-mem-init.

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildSafeInjection, wrapAsData, checkIntegritySigned, signManifest,
  deriveInitMarker, verifyInitMarker,
} = require('./memory-guard');

const HMAC_ENV_VAR = 'VLDR_MEMORY_HMAC_KEY';

// All path/env resolution is funneled through an injectable "context" so tests can point home,
// VLDR_HOME and the off-boundary init-marker at a TEMP dir WITHOUT ever touching the real
// ~/.volundr or ~/.vldr-mem-init. Production callers pass nothing → these read the real env/home.
//   env       — defaults to process.env (source of VLDR_HOME + VLDR_MEMORY_HMAC_KEY)
//   homeDir   — defaults to os.homedir() (anchor for the OUT-OF-BOUNDARY init marker)
//   markerPath— optional explicit override of the init-marker file path (tests)
function resolveCtx(opts = {}) {
  const env = opts.env || process.env;
  const homeDir = opts.homeDir || os.homedir();
  return { env, homeDir, markerPathOverride: opts.markerPath || null };
}

function vldrHome(ctx) {
  const c = ctx || resolveCtx();
  return c.env.VLDR_HOME || path.join(c.homeDir, '.volundr');
}

function manifestPath(ctx) {
  return path.join(vldrHome(ctx || resolveCtx()), 'global', 'memory-approved.json');
}

// FRW-BL-072 — the init marker lives OUTSIDE the VLDR_HOME write boundary: a sibling of
// ~/.volundr at ~/.vldr-mem-init (NOT under VLDR_HOME). An attacker with VLDR_HOME write access
// therefore cannot delete/forge it from within that boundary. Anchored to homeDir, NOT to
// VLDR_HOME, so even if VLDR_HOME is relocated the marker stays off-boundary.
function initMarkerPath(ctx) {
  const c = ctx || resolveCtx();
  if (c.markerPathOverride) return c.markerPathOverride;
  return path.join(c.homeDir, '.vldr-mem-init');
}

// Read the HMAC key from the environment ONLY. Deliberately NOT read from any file under
// VLDR_HOME — keeping it outside that write boundary is the whole point (see header). Returns
// null when unset/blank so callers degrade to unsigned TOFU with a warning.
function loadHmacKey(ctx) {
  const c = ctx || resolveCtx();
  const k = c.env[HMAC_ENV_VAR];
  if (typeof k === 'string' && k.trim().length > 0) return k;
  return null;
}

// Read the on-disk init marker (the off-boundary "store was initialized" anchor). Returns the
// trimmed string, or null if absent/unreadable. Never throws — marker IO must not crash a session.
function loadInitMarker(ctx) {
  try {
    const raw = fs.readFileSync(initMarkerPath(ctx || resolveCtx()), 'utf8');
    return typeof raw === 'string' ? raw.trim() : null;
  } catch {
    return null;
  }
}

// Write the key-derived init marker to the off-boundary path. Best-effort (must never crash a
// session). No-op when no key (the marker scheme is key-gated). Returns true on success.
// SECURITY: writes only the one-way HMAC token (deriveInitMarker), NEVER the key itself.
function writeInitMarker(key, ctx) {
  if (!key) return false;
  try {
    const p = initMarkerPath(ctx || resolveCtx());
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, deriveInitMarker(key));
    return true;
  } catch {
    return false;
  }
}

// Load the on-disk signed manifest. Tolerates: missing file, malformed JSON, legacy bare-entries
// maps (pre-FRW-BL-069 plaintext { "kind:id": "hash" }). Returns the parsed object as-is;
// checkIntegritySigned() decides how to interpret it (envelope vs bare, signed vs not).
function loadSignedManifest(ctx) {
  try {
    const raw = fs.readFileSync(manifestPath(ctx || resolveCtx()), 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

// Whether the signed manifest file actually exists on disk. Distinguishes "absent file" (the
// FRW-BL-072 deletion vector) from "present-but-empty/blank" — both yield {} from
// loadSignedManifest, but only the ABSENT case combined with a valid init marker is a deletion.
function manifestExists(ctx) {
  try {
    return fs.existsSync(manifestPath(ctx || resolveCtx()));
  } catch {
    return false;
  }
}

// Persist a signed manifest envelope { version, alg, entries, sig }. Best-effort: manifest
// persistence must never crash a session. Returns true on success, false otherwise.
function saveSignedManifest(signed, ctx) {
  try {
    const p = manifestPath(ctx || resolveCtx());
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
// FRW-BL-072 injection points (production callers pass none → real env/home):
//   opts.env / opts.homeDir / opts.markerPath — redirect the key, VLDR_HOME and the off-boundary
//     init marker so tests run against a TEMP dir without touching real state.
//   opts.bootstrapConsent — explicit operator recovery: re-bootstrap even when a deleted manifest
//     is detected (default false → withhold).
//
// Returns { text, trusted, withheld, signatureValid, signatureRequired, signed, manifestDeleted }.
//   - text: the full injection string — each trusted item fenced as untrusted DATA, plus a
//     quarantine note naming any withheld items.
//   - signatureValid/signatureRequired: provenance of the integrity decision (see memory-guard).
//   - manifestDeleted: true when the off-boundary marker proved a DELETION attack (memory withheld).
function wrapAllMemory(items, opts = {}) {
  const persist = opts.persist !== false;
  const warn = typeof opts.warn === 'function' ? opts.warn : () => {};
  const list = Array.isArray(items) ? items.filter((i) => i && i.content != null) : [];

  const ctx = resolveCtx(opts);
  const key = loadHmacKey(ctx);

  // FRW-BL-072 — detect the manifest-DELETION downgrade. The marker scheme is KEY-GATED: with no
  // key we leave unsigned-TOFU behaviour completely untouched (wasInitialized stays false).
  let wasInitialized = false;
  if (key) {
    const manifestPresent = manifestExists(ctx);
    if (!manifestPresent) {
      // Manifest file is ABSENT. Consult the off-boundary marker: if it matches the key-derived
      // token, this store WAS established → the manifest was deleted (attack). If absent/mismatch,
      // treat as genuine first boot (and we will write the marker after a clean bootstrap below).
      const storedMarker = loadInitMarker(ctx);
      wasInitialized = verifyInitMarker(storedMarker, key);
    }
  }

  const onDisk = loadSignedManifest(ctx);
  const res = checkIntegritySigned(list, onDisk, key, { ...opts, wasInitialized });

  // Surface degrade / rejection state so the operator is never silently mis-served.
  if (!key) {
    warn('memory_unsigned_degrade',
      `${HMAC_ENV_VAR} unset — memory integrity running in UNSIGNED TOFU mode. A poisoned lesson `
      + 'could also rewrite the manifest hash and be auto-approved. Set ' + HMAC_ENV_VAR
      + ' (outside VLDR_HOME) for tamper-proof signed verification.',
      { signatureRequired: false });
  } else if (res.manifestDeleted) {
    warn('memory_manifest_deleted',
      'Signed memory manifest is ABSENT but the off-boundary init marker proves this store was '
      + `already established — the manifest was DELETED. WITHHOLDING all ${res.withheld.length} `
      + 'memory item(s) (refusing to re-trust present content on first-use). This is the expected '
      + 'response to a manifest-deletion attack. To recover after review, re-run with explicit '
      + 'operator bootstrap consent.',
      { withheld: res.withheld.map((w) => `${w.kind}:${w.id}`).join(',') });
  } else if (!res.signatureValid && res.withheld.length > 0) {
    // Only a REAL rejection warrants this warning: signature invalid AND items were withheld
    // (manifest-rewrite attack). A clean empty-baseline bootstrap also reports signatureValid
    // false but withholds nothing — that is normal first-boot, not a failure, so stay silent.
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
      : (res.manifestDeleted
        ? 'signed manifest DELETED while the off-boundary init marker proves prior init (possible deletion attack)'
        : (!res.signatureValid
          ? 'signed-manifest verification FAILED — manifest signature missing/forged (possible rewrite attack)'
          : 'integrity hash changed since approval (possible tampering)'));
    text += `\n\n[memory-guard] WITHHELD ${res.withheld.length} memory item(s) — ${reason}: `
      + res.withheld.map((w) => `${w.kind}:${w.id}`).join(', ')
      + '. They are NOT injected; re-approve (write a validly-signed manifest) after review.';
  }

  if (persist) {
    // Persist the re-signed manifest with any TOFU additions in the normal cases (valid
    // signature, empty-baseline bootstrap, or no-key unsigned mode). Two cases must NOT overwrite:
    //   (1) manifest-REWRITE ATTACK (key present, signature invalid over a NON-empty baseline) —
    //       re-signing { } would clobber the operator's real signed baseline and mask the attack.
    //   (2) manifest-DELETION ATTACK (FRW-BL-072: key present, empty baseline, init marker valid) —
    //       writing a fresh bootstrap manifest would re-establish trust on poisoned content and
    //       erase the deletion evidence. Skip persistence and keep the store withheld.
    // checkIntegritySigned marks (1) with the 'manifest-signature-invalid' withhold reason and (2)
    // with res.manifestDeleted; detect both precisely so a clean first boot (empty baseline →
    // signatureValid false but NOT an attack) still persists.
    const rewriteAttack = key
      && !res.signatureValid
      && res.withheld.some((w) => w.reason === 'manifest-signature-invalid');
    if (rewriteAttack || res.manifestDeleted) {
      // intentionally skip persistence — preserve evidence of the rewrite/deletion attempt
    } else {
      saveSignedManifest(res.signed, ctx);
      // FRW-BL-072 — after a clean signed bootstrap/verify, ensure the off-boundary marker exists
      // so a FUTURE deletion of this manifest is detectable. Key-gated + best-effort; writes only
      // the one-way HMAC token, never the key. (No-op when no key; idempotent when already present.)
      if (key) writeInitMarker(key, ctx);
    }
  }

  return {
    text,
    trusted: res.trusted,
    withheld: res.withheld,
    signatureValid: res.signatureValid,
    signatureRequired: res.signatureRequired,
    signed: res.signed,
    manifestDeleted: !!res.manifestDeleted,
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
  initMarkerPath, loadInitMarker, writeInitMarker, manifestExists,
};
