/**
 * Data warehouse source detection.
 *
 * Scans a project for codebase signals (package manifests, `.env` key
 * names) and matches them against the detectors the caller passes in, from
 * `loadSourceDetectors`. Pure function: no store mutations, no UI calls.
 * Reads files locally — only the wizard process does this; the agent never
 * sees secret values.
 *
 * Note we only read `.env` KEY NAMES, never values.
 */

import { analytics } from '@utils/analytics';
import type { ProgramSession } from '../program-session';
import { walkProjectFiles, safeReadFile } from '@utils/bounded-fs';
import {
  ENV_SCAN_MAX_DEPTH,
  MAX_ENV_KEY_SET,
  isEnvFileName,
  parseEnvKeyNames,
  toPromptSafeRelativePath,
} from '@utils/env-scan';
import type { PackageJson } from '@utils/package-json';
import {
  parseRequirementsTxt,
  parsePyprojectToml,
  parsePipfile,
} from '../detection/features';
import type {
  DetectedSource,
  DetectedTool,
  ScanSignal,
  SourceDetector,
} from './types.js';

interface ProjectSignals {
  /**
   * Key NAME → the project-relative `.env*` file that first defined it. The
   * path is sanitised on the way in, so nothing here can reach a prompt raw.
   */
  envKeys: Map<string, string>;
  /**
   * Ecosystem (`npm`, `pypi`, `rubygems`, ...) → package name → the
   * project-relative manifest that first declared it.
   */
  packages: Map<string, Map<string, string>>;
  /** False when the walk stopped at a cap or skipped a directory it could not read. */
  complete: boolean;
}

// Shared with `check_env_keys` so the tool scans exactly what the detector
// scanned — see `@utils/env-scan`.
const MAX_DEPTH = ENV_SCAN_MAX_DEPTH;

// Each signal Set retains at most this many entries.
const MAX_SIGNAL_SET = MAX_ENV_KEY_SET;

// A tool reports at most this many matched signals.
const MAX_SIGNALS_PER_TOOL = 50;

function addPackage(
  signals: ProjectSignals,
  ecosystem: string,
  name: string,
  file: string,
): void {
  let names = signals.packages.get(ecosystem);
  if (!names) {
    names = new Map();
    signals.packages.set(ecosystem, names);
  }
  if (names.size < MAX_SIGNAL_SET && !names.has(name)) names.set(name, file);
}

/** Where `matchedSignal` says a package was found, per ecosystem. */
const PACKAGE_SIGNAL_LOCATIONS: Readonly<Record<string, string>> = {
  npm: 'package.json',
  pypi: 'Python dependencies',
  rubygems: 'Gemfile',
};

/** The catalog tools a scan found, and whether it saw the whole project. */
export type ToolScan = {
  tools: DetectedTool[];
  /**
   * False when the walk stopped at a cap or skipped a directory it could not
   * read. A tool missing from a partial scan may still be in the project.
   */
  complete: boolean;
};

/**
 * Detect every catalog tool the project at `installDir` appears to use,
 * including tools the wizard never offers as a warehouse source. Each carries
 * the signals that matched it, for reporting.
 */
export function detectTools(
  installDir: string,
  detectors: readonly SourceDetector[],
): ToolScan {
  // No directory guard here: walkProjectFiles is best-effort and yields no
  // signals for a missing/unreadable dir (→ []). The program-level detect
  // step is responsible for surfacing a structured `bad-directory` error.
  const signals = collectSignals(installDir);

  const detected: DetectedTool[] = [];
  for (const detector of detectors) {
    const matched = matchDetector(detector, signals);
    if (matched.length === 0) continue;
    detected.push({
      kind: detector.kind,
      label: detector.label,
      warehouseSourceType: detector.warehouseSourceType,
      mode: detector.mode,
      matchedSignal: describeSignal(matched[0]),
      signals: matched,
    });
  }
  return { tools: detected, complete: signals.complete };
}

/**
 * The detected tools a user can import as warehouse sources, minus the ones a
 * more specific match supersedes. Kinds are unique, so the result is deduped.
 */
export function toWarehouseSources(
  tools: readonly DetectedTool[],
  detectors: readonly SourceDetector[],
): DetectedSource[] {
  const kinds = new Set(tools.map((tool) => tool.kind));
  const supersededBy = new Map(
    detectors.map((detector) => [detector.kind, detector.supersededBy ?? []]),
  );
  const sources: DetectedSource[] = [];
  for (const tool of tools) {
    const { mode, warehouseSourceType } = tool;
    // A tool with no setup mode is detected for reporting only, never offered as a source.
    if (mode === null || warehouseSourceType === null) continue;
    if (isSuperseded(supersededBy.get(tool.kind) ?? [], kinds)) continue;
    sources.push({
      kind: warehouseSourceType,
      label: tool.label,
      mode,
      matchedSignal: tool.matchedSignal,
    });
  }
  return sources;
}

/** Detect which warehouse sources the project at `installDir` appears to use. */
export function detectWarehouseSources(
  installDir: string,
  detectors: readonly SourceDetector[],
): DetectedSource[] {
  return toWarehouseSources(
    detectTools(installDir, detectors).tools,
    detectors,
  );
}

/**
 * Whether a more specific match covers this detector's data. Every consumer
 * treats a detected kind as a source to create, so a project whose Postgres
 * lives on Neon or Supabase would otherwise be offered both and end up with
 * the same tables imported twice.
 */
function isSuperseded(
  supersededBy: readonly string[],
  detectedKinds: ReadonlySet<string>,
): boolean {
  return supersededBy.some((other) => detectedKinds.has(other));
}

/**
 * Every signal that matches the detector, capped per tool. Packages come before
 * `.env` keys: a package shows the code uses the tool, while a key can outlive it.
 */
function matchDetector(
  detector: SourceDetector,
  signals: ProjectSignals,
): ScanSignal[] {
  const { envKeys, packages } = detector.signals;
  const matched: ScanSignal[] = [];

  for (const [ecosystem, names] of Object.entries(packages)) {
    const found = signals.packages.get(ecosystem);
    if (!found) continue;
    for (const name of names) {
      const file = found.get(name);
      if (file !== undefined) matched.push({ source: ecosystem, name, file });
    }
  }

  if (envKeys.length > 0) {
    for (const [key, file] of signals.envKeys) {
      if (envKeys.some((re) => re.test(key))) {
        matched.push({ source: ENV_KEY_SIGNAL_SOURCE, name: key, file });
      }
    }
  }

  return matched.slice(0, MAX_SIGNALS_PER_TOOL);
}

/** Signal source for a `.env` key name. */
const ENV_KEY_SIGNAL_SOURCE = 'env_key';

/**
 * The human-readable form of a signal, shown on screens and given to the agent.
 *
 * For an env key, name the file that actually matched. The agent acts on this
 * string, so pointing it at `.env` when the key lives in `apps/api/.env.local`
 * sends it to look in the wrong place and conclude the credential is absent.
 *
 * Both interpolated parts are repository-derived, so both are quoted as code
 * and both are constrained. `parseEnvKeyNames` limits the key to
 * `[A-Za-z_][A-Za-z0-9_]*`. The path is the unconstrained part: the repository
 * names its own directories, so it arrives already sanitised from
 * `toPromptSafeRelativePath` and cannot break out of the code span.
 */
function describeSignal(signal: ScanSignal): string {
  if (signal.source === ENV_KEY_SIGNAL_SOURCE) {
    return `found \`${signal.name}\` in \`${signal.file ?? '.env'}\``;
  }
  const location =
    PACKAGE_SIGNAL_LOCATIONS[signal.source] ?? `${signal.source} dependencies`;
  return `found \`${signal.name}\` in ${location}`;
}

function collectSignals(installDir: string): ProjectSignals {
  const signals: ProjectSignals = {
    envKeys: new Map(),
    packages: new Map(),
    complete: true,
  };

  signals.complete = walkProjectFiles(
    installDir,
    (name, fullPath) => ingestFile(installDir, name, fullPath, signals),
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
  installDir: string,
  name: string,
  fullPath: string,
  signals: ProjectSignals,
): void {
  const ingest = ingestorFor(name);
  if (!ingest) return;

  const content = safeReadFile(fullPath);
  if (content === null) return;

  ingest(content, signals, toPromptSafeRelativePath(installDir, fullPath));
}

type Ingestor = (
  content: string,
  signals: ProjectSignals,
  relativePath: string,
) => void;

/** Pick the parser for a manifest filename, or null if it's not one we read. */
function ingestorFor(name: string): Ingestor | null {
  if (isEnvFileName(name))
    return (c, s, relativePath) => addEnvKeys(c, s, relativePath);
  if (name === 'package.json') return addNpmDeps;
  if (name === 'requirements.txt')
    return (c, s, file) =>
      parseRequirementsTxt(c).forEach((d) => addPackage(s, 'pypi', d, file));
  if (name === 'pyproject.toml')
    return (c, s, file) =>
      parsePyprojectToml(c).forEach((d) => addPackage(s, 'pypi', d, file));
  if (name === 'Pipfile')
    return (c, s, file) =>
      parsePipfile(c).forEach((d) => addPackage(s, 'pypi', d, file));
  if (name === 'Gemfile')
    return (c, s, file) =>
      parseGemfile(c).forEach((g) => addPackage(s, 'rubygems', g, file));
  return null;
}

/**
 * Record each key NAME against the file that defined it. The first file wins,
 * so the reported signal stays stable when several `.env*` files repeat a key.
 * Values are never read.
 */
function addEnvKeys(
  content: string,
  signals: ProjectSignals,
  relativePath: string,
): void {
  for (const key of parseEnvKeyNames(content)) {
    if (signals.envKeys.has(key)) continue;
    if (signals.envKeys.size >= MAX_SIGNAL_SET) return;
    signals.envKeys.set(key, relativePath);
  }
}

function addNpmDeps(
  content: string,
  signals: ProjectSignals,
  file: string,
): void {
  try {
    const pkg = JSON.parse(content) as PackageJson;
    for (const dep of Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    })) {
      addPackage(signals, 'npm', dep, file);
    }
  } catch (error) {
    // Malformed package.json — skip it, but record that we hit it.
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'detectWarehouseSources.parsePackageJson' },
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

/**
 * Extract KEY NAMES from a dotenv file. Values are intentionally discarded.
 * Re-exported from `@utils/env-scan`, which `check_env_keys` shares, so the
 * detector and the tool cannot disagree about what counts as a key.
 */
export { parseEnvKeyNames as parseEnvKeys } from '@utils/env-scan';

/** frameworkContext key holding the detected sources (set on success). */
export const DETECTED_WAREHOUSE_SOURCES_KEY = 'detectedWarehouseSources';

/**
 * Read the detected sources out of frameworkContext. Single accessor shared by
 * the intro screen and the prompt builder so the key + cast live in one place.
 */
export function getDetectedWarehouseSources(
  session: ProgramSession,
): DetectedSource[] {
  return (
    (session.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY] as
      | DetectedSource[]
      | undefined) ?? []
  );
}
