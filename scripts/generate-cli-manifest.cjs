/**
 * Snapshot context-mill's cli-manifest.json into a typed TS module.
 *
 * Fetches from REMOTE_SKILLS_BASE_URL at build time. Falls back to a local
 * cache when the network or release is unavailable, and finally to an empty
 * manifest so the build never breaks. The generated file is gitignored —
 * regenerated on every prebuild.
 *
 * Each load is validated against a JSON Schema before being accepted.
 * Schema drift between context-mill and wizard (extra fields, wrong types,
 * naming-convention violations) gets caught here at build time instead of
 * surfacing at runtime. A manifest we successfully fetched but that fails
 * validation is treated as real drift and FAILS the build (exit 1) — it is
 * not swallowed by the offline fallback chain.
 *
 * Fallback chain:
 *   1. Remote (GitHub release URL)
 *   2. Local cache at .cache/cli-manifest.json
 *   3. Bootstrap snapshot at cli-manifest.bootstrap.json (committed to the
 *      repo — keeps the wizard buildable before context-mill cuts a release
 *      with the new file)
 *   4. Empty manifest (no entries)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const Ajv = require('ajv');

const REPO_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(REPO_ROOT, '.cache');
const CACHE_PATH = path.join(CACHE_DIR, 'cli-manifest.json');
const BOOTSTRAP_PATH = path.join(REPO_ROOT, 'cli-manifest.bootstrap.json');
const SCHEMA_BOOTSTRAP_PATH = path.join(
  REPO_ROOT,
  'cli-manifest.schema.bootstrap.json',
);
const SCHEMA_CACHE_PATH = path.join(CACHE_DIR, 'cli-manifest.schema.json');
const OUT_PATH = path.join(
  REPO_ROOT,
  'src',
  'lib',
  'programs',
  'cli-manifest.generated.ts',
);

// Mirrors REMOTE_SKILLS_BASE_URL in src/lib/constants.ts. Kept as a literal
// here so the prebuild doesn't need to import the TS source.
const REMOTE_BASE_URL =
  'https://github.com/PostHog/context-mill/releases/latest/download';
const REMOTE_MANIFEST_URL = `${REMOTE_BASE_URL}/cli-manifest.json`;
const REMOTE_SCHEMA_URL = `${REMOTE_BASE_URL}/cli-manifest.schema.json`;

function logWarning(message) {
  process.stderr.write(`[generate-cli-manifest] ${message}\n`);
}

function fetchJson(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (resp) => {
      const status = resp.statusCode || 0;
      if (status >= 300 && status < 400 && resp.headers.location) {
        if (redirectsRemaining <= 0) {
          reject(new Error('too many redirects'));
          return;
        }
        resp.resume();
        fetchJson(resp.headers.location, redirectsRemaining - 1)
          .then(resolve, reject);
        return;
      }
      if (status !== 200) {
        resp.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(new Error(`JSON parse failed: ${err.message}`));
        }
      });
      resp.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(10_000, () => {
      request.destroy(new Error('fetch timed out after 10s'));
    });
  });
}

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (err) {
    logWarning(`cache at ${CACHE_PATH} is unreadable: ${err.message}`);
    return null;
  }
}

function writeCache(manifest) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(manifest, null, 2));
}

/**
 * Load the JSON Schema with the same fallback chain as the manifest itself.
 * Remote → cache → bootstrap. Empty fallback is never used here — without a
 * schema we have no contract, so we'd rather fail loudly than validate
 * nothing.
 */
async function loadSchema() {
  try {
    const remote = await fetchJson(REMOTE_SCHEMA_URL);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(SCHEMA_CACHE_PATH, JSON.stringify(remote, null, 2));
    return { schema: remote, source: `remote (${REMOTE_SCHEMA_URL})` };
  } catch (err) {
    logWarning(`remote schema fetch failed: ${err.message}`);
  }
  if (fs.existsSync(SCHEMA_CACHE_PATH)) {
    try {
      return {
        schema: JSON.parse(fs.readFileSync(SCHEMA_CACHE_PATH, 'utf8')),
        source: `cache (${SCHEMA_CACHE_PATH})`,
      };
    } catch (err) {
      logWarning(`cached schema is unreadable: ${err.message}`);
    }
  }
  if (fs.existsSync(SCHEMA_BOOTSTRAP_PATH)) {
    return {
      schema: JSON.parse(fs.readFileSync(SCHEMA_BOOTSTRAP_PATH, 'utf8')),
      source: `bootstrap (${SCHEMA_BOOTSTRAP_PATH})`,
    };
  }
  throw new Error(
    'no JSON Schema available — refusing to write the generated TS without a contract to validate against.',
  );
}

function buildValidator(schema) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

function validateManifest(raw, source, validator) {
  if (!validator(raw)) {
    const formatted = (validator.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    throw new Error(`${source}: schema validation failed — ${formatted}`);
  }
  return raw;
}

function emptyManifest() {
  return {
    version: '1.0',
    buildVersion: 'empty-fallback',
    buildTimestamp: '1970-01-01T00:00:00.000Z',
    entries: [],
  };
}

function renderTypeScript(manifest, source) {
  const json = JSON.stringify(manifest, null, 2);
  return `// Auto-generated by scripts/generate-cli-manifest.cjs — do not edit.
// Source: ${source}
//
// Snapshot of context-mill's dist/skills/cli-manifest.json taken at build
// time. The wizard imports this module instead of fetching at runtime, so
// the published binary is offline-capable.

import type { ProgramCliSurface } from '@lib/programs/program-step';

export interface CliManifestEntry {
  skillId: string;
  role: ProgramCliSurface['role'];
  command?: string;
  parentCommand?: string;
  /**
   * When true, this leaf is the recommended (pre-highlighted) option when
   * the family parent is invoked with no subcommand (e.g. \`wizard audit\`
   * pre-highlights the entry marked recommended). At most one entry per
   * family parent should be marked.
   */
  recommended?: boolean;
  displayName: string;
  description: string;
}

export interface CliManifest {
  version: string;
  buildVersion: string;
  buildTimestamp: string;
  entries: CliManifestEntry[];
}

export const CLI_MANIFEST: CliManifest = ${json};
`;
}

async function loadManifest(validator) {
  // Separate "couldn't reach the network" from "fetched a manifest that
  // doesn't match the schema". The first is an offline build — fall back
  // quietly. The second is real schema drift between context-mill and the
  // wizard, so we fail loudly (validateManifest throws → exit 1) instead of
  // silently shipping a stale surface from the cache or bootstrap.
  let remote;
  try {
    remote = await fetchJson(REMOTE_MANIFEST_URL);
  } catch (remoteErr) {
    logWarning(`remote fetch failed: ${remoteErr.message}`);
  }
  if (remote !== undefined) {
    const validated = validateManifest(remote, 'remote', validator);
    writeCache(validated);
    return { manifest: validated, source: `remote (${REMOTE_MANIFEST_URL})` };
  }

  const cached = readCache();
  if (cached) {
    try {
      const validated = validateManifest(cached, 'cache', validator);
      return {
        manifest: validated,
        source: `local cache (${CACHE_PATH})`,
      };
    } catch (cacheErr) {
      logWarning(`cache is invalid: ${cacheErr.message}`);
    }
  }

  if (fs.existsSync(BOOTSTRAP_PATH)) {
    try {
      const bootstrap = JSON.parse(fs.readFileSync(BOOTSTRAP_PATH, 'utf8'));
      const validated = validateManifest(bootstrap, 'bootstrap', validator);
      return {
        manifest: validated,
        source: `bootstrap snapshot (${BOOTSTRAP_PATH})`,
      };
    } catch (bootstrapErr) {
      logWarning(`bootstrap is invalid: ${bootstrapErr.message}`);
    }
  }

  logWarning(
    'no manifest available — writing empty fallback. Run with network access to populate.',
  );
  // The empty fallback isn't schema-validated by design — it's the
  // last-resort "build never breaks" path. Real manifests must validate.
  return { manifest: emptyManifest(), source: 'empty fallback' };
}

async function main() {
  const { schema, source: schemaSource } = await loadSchema();
  process.stdout.write(
    `[generate-cli-manifest] loaded schema from ${schemaSource}\n`,
  );
  const validator = buildValidator(schema);
  const { manifest, source } = await loadManifest(validator);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, renderTypeScript(manifest, source));
  process.stdout.write(
    `[generate-cli-manifest] wrote ${OUT_PATH} (${manifest.entries.length} entries, source: ${source})\n`,
  );
}

main().catch((err) => {
  logWarning(`fatal: ${err.message}`);
  process.exit(1);
});
