/**
 * Data warehouse source detection.
 *
 * Scans a project for codebase signals (npm/python/ruby deps, `.env` key
 * names) and matches them against the `SOURCE_DETECTORS` registry. Pure
 * function: no store mutations, no UI calls. Reads files locally — only the
 * wizard process does this; the agent never sees secret values.
 *
 * Note we only read `.env` KEY NAMES, never values.
 */

import { analytics } from '@utils/analytics';
import { walkProjectFiles, safeReadFile } from '@utils/file-utils';
import type { PackageJson } from '@utils/package-json';
import {
  parseRequirementsTxt,
  parsePyprojectToml,
  parsePipfile,
} from '@lib/detection/features';
import { SOURCE_DETECTORS } from './registry.js';
import type { DetectedSource, SourceDetector } from './types.js';

interface ProjectSignals {
  npm: Set<string>;
  python: Set<string>;
  ruby: Set<string>;
  envKeys: Set<string>;
}

const MAX_DEPTH = 3;

/**
 * Detect which warehouse sources the project at `installDir` appears to use.
 * Returns one `DetectedSource` per matched registry entry (kinds are unique,
 * so the result is naturally deduped).
 */
export function detectWarehouseSources(installDir: string): DetectedSource[] {
  // No directory guard here: walkProjectFiles is best-effort and yields no
  // signals for a missing/unreadable dir (→ []). The program-level detect
  // step is responsible for surfacing a structured `bad-directory` error.
  const signals = collectSignals(installDir);

  const detected: DetectedSource[] = [];
  for (const detector of SOURCE_DETECTORS) {
    const match = matchDetector(detector, signals);
    if (match) {
      detected.push({
        kind: detector.kind,
        label: detector.label,
        mode: detector.mode,
        matchedSignal: match,
      });
    }
  }
  return detected;
}

/** Returns a human-readable description of the first matching signal, or null. */
function matchDetector(
  detector: SourceDetector,
  signals: ProjectSignals,
): string | null {
  const { npm, python, ruby, envKeys } = detector.signals;

  const npmHit = npm?.find((dep) => signals.npm.has(dep));
  if (npmHit) return `found \`${npmHit}\` in package.json`;

  const pyHit = python?.find((dep) => signals.python.has(dep));
  if (pyHit) return `found \`${pyHit}\` in Python dependencies`;

  const rubyHit = ruby?.find((gem) => signals.ruby.has(gem));
  if (rubyHit) return `found \`${rubyHit}\` in Gemfile`;

  if (envKeys) {
    for (const key of signals.envKeys) {
      if (envKeys.some((re) => re.test(key))) {
        return `found \`${key}\` in .env`;
      }
    }
  }

  return null;
}

function collectSignals(installDir: string): ProjectSignals {
  const signals: ProjectSignals = {
    npm: new Set(),
    python: new Set(),
    ruby: new Set(),
    envKeys: new Set(),
  };

  walkProjectFiles(
    installDir,
    (name, fullPath) => ingestFile(name, fullPath, signals),
    MAX_DEPTH,
  );

  return signals;
}

/**
 * Route a file to the right parser BY NAME, reading its contents only when the
 * name matches one of the ~6 manifests we care about. Checking the name first
 * avoids slurping every file in the tree (lockfiles, binaries, assets) into
 * memory just to discard it.
 */
function ingestFile(
  name: string,
  fullPath: string,
  signals: ProjectSignals,
): void {
  const ingest = ingestorFor(name);
  if (!ingest) return;

  const content = safeReadFile(fullPath);
  if (content === null) return;

  ingest(content, signals);
}

type Ingestor = (content: string, signals: ProjectSignals) => void;

/** Pick the parser for a manifest filename, or null if it's not one we read. */
function ingestorFor(name: string): Ingestor | null {
  if (name === 'package.json') return addNpmDeps;
  if (name === 'requirements.txt')
    return (c, s) => parseRequirementsTxt(c).forEach((d) => s.python.add(d));
  if (name === 'pyproject.toml')
    return (c, s) => parsePyprojectToml(c).forEach((d) => s.python.add(d));
  if (name === 'Pipfile')
    return (c, s) => parsePipfile(c).forEach((d) => s.python.add(d));
  if (name === 'Gemfile')
    return (c, s) => parseGemfile(c).forEach((g) => s.ruby.add(g));
  if (name.startsWith('.env'))
    return (c, s) => parseEnvKeys(c).forEach((k) => s.envKeys.add(k));
  return null;
}

function addNpmDeps(content: string, signals: ProjectSignals): void {
  try {
    const pkg = JSON.parse(content) as PackageJson;
    for (const dep of Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    })) {
      signals.npm.add(dep);
    }
  } catch (error) {
    // Malformed package.json — skip it, but record that we hit it.
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { op: 'detectWarehouseSources.parsePackageJson' },
    );
  }
}

/** Extract gem names from `gem 'name'` declarations. */
export function parseGemfile(content: string): string[] {
  const gems: string[] = [];
  for (const match of content.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)) {
    gems.push(match[1]);
  }
  return gems;
}

/** Extract KEY NAMES from a dotenv file. Values are intentionally discarded. */
export function parseEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.push(match[1]);
  }
  return keys;
}
