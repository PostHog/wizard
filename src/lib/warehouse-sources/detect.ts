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

import type { Dirent } from 'fs';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { IGNORED_DIRS } from '@utils/file-utils';
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
  if (!existsSync(installDir)) return [];
  try {
    if (!statSync(installDir).isDirectory()) return [];
  } catch {
    return [];
  }

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

  function scan(dir: string, depth: number): void {
    if (depth > MAX_DEPTH) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && !entry.name.startsWith('.env'))
        continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isFile()) {
        ingestFile(entry.name, fullPath, signals);
      } else if (entry.isDirectory()) {
        scan(fullPath, depth + 1);
      }
    }
  }

  scan(installDir, 0);
  return signals;
}

function ingestFile(
  name: string,
  fullPath: string,
  signals: ProjectSignals,
): void {
  const content = safeRead(fullPath);
  if (content === null) return;

  if (name === 'package.json') {
    addNpmDeps(content, signals);
  } else if (name === 'requirements.txt') {
    parseRequirementsTxt(content).forEach((d) => signals.python.add(d));
  } else if (name === 'pyproject.toml') {
    parsePyprojectToml(content).forEach((d) => signals.python.add(d));
  } else if (name === 'Pipfile') {
    parsePipfile(content).forEach((d) => signals.python.add(d));
  } else if (name === 'Gemfile') {
    parseGemfile(content).forEach((g) => signals.ruby.add(g));
  } else if (name === '.env' || name.startsWith('.env')) {
    parseEnvKeys(content).forEach((k) => signals.envKeys.add(k));
  }
}

function addNpmDeps(content: string, signals: ProjectSignals): void {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const dep of Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    })) {
      signals.npm.add(dep);
    }
  } catch {
    // Skip malformed package.json
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

function safeRead(fullPath: string): string | null {
  try {
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}
