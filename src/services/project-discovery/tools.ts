/**
 * The tool match: which catalog tools a project appears to use.
 *
 * Matches what the walk read (package names per manifest, `.env` key names,
 * script hosts in templates) against the detectors the caller passes in, from
 * `loadSourceDetectors`. Pure: it reads the walk, never the repo.
 */

import { MAX_ENV_KEY_SET } from '@utils/env-scan';
import type {
  SourceCreationMode,
  SourceDetector,
} from '../warehouse-sources/types';
import type { RepoFiles } from './walk';

/** One codebase signal behind a discovered tool, as reported to PostHog. */
export interface ToolSignal {
  /** Where the signal came from: an ecosystem (`npm`, `pypi`, ...), `env_key`, or `script_host`. */
  source: string;
  /** The package name, env key name, or script hostname. Never an env value. */
  name: string;
  /** Root-relative path of the file it was found in, prompt-safe. */
  file: string | null;
}

/** A catalog tool found in the project, whether or not the wizard can set it up. */
export interface DetectedTool {
  kind: string;
  label: string;
  warehouseSourceType: string | null;
  mode: SourceCreationMode | null;
  /** Human-readable description of the first matching signal, for display. */
  matchedSignal: string;
  /**
   * In the walk's match, one signal per file that holds a matching name, so
   * each project keeps its own evidence. {@link toolsUnder} gives one project's
   * tools, with one signal per name.
   */
  signals: ToolSignal[];
}

interface ProjectSignals {
  /** Key NAME → the root-relative `.env*` files that define it, in walk order. */
  envKeys: Map<string, readonly string[]>;
  /** Catalog script host → the templates that load from it, in walk order. */
  scriptHosts: Map<string, string[]>;
  /**
   * Ecosystem (`npm`, `pypi`, `rubygems`, ...) → package name → the
   * root-relative manifests that declare it, in walk order.
   */
  packages: Map<string, Map<string, string[]>>;
}

// Each signal Set retains at most this many entries.
const MAX_SIGNAL_SET = MAX_ENV_KEY_SET;

// One project's tool shows and reports at most this many signals.
const MAX_SIGNALS_PER_TOOL = 50;

// One name keeps at most this many files, and one tool this many signals in all.
const MAX_FILES_PER_SIGNAL = 50;
const MAX_TOOL_EVIDENCE = 500;

/** The walk as match signals: every file that holds a name, so two projects that share one both keep it. */
function signalsFrom(repo: RepoFiles): ProjectSignals {
  const signals: ProjectSignals = {
    envKeys: new Map(),
    scriptHosts: new Map(),
    packages: new Map(),
  };
  for (const { host, file } of repo.scriptHosts) {
    signals.scriptHosts.set(host, [
      ...(signals.scriptHosts.get(host) ?? []),
      file,
    ]);
  }
  for (const manifest of repo.manifests) {
    let names = signals.packages.get(manifest.ecosystem);
    if (!names) {
      names = new Map();
      signals.packages.set(manifest.ecosystem, names);
    }
    for (const name of manifest.packages) {
      const files = names.get(name);
      if (files) {
        if (files.length < MAX_FILES_PER_SIGNAL) files.push(manifest.path);
      } else if (names.size < MAX_SIGNAL_SET) {
        names.set(name, [manifest.path]);
      }
    }
  }
  for (const { name, files } of repo.envKeys) {
    if (signals.envKeys.size >= MAX_SIGNAL_SET) break;
    signals.envKeys.set(name, files);
  }
  return signals;
}

/** Where `matchedSignal` says a package was found, per ecosystem. */
const PACKAGE_SIGNAL_LOCATIONS: Readonly<Record<string, string>> = {
  npm: 'package.json',
  pypi: 'Python dependencies',
  rubygems: 'Gemfile',
};

/** The catalog tools discovery found, and whether it saw the whole project. */
export type DiscoveredTools = {
  tools: DetectedTool[];
  /**
   * False when the walk stopped at a cap or skipped a directory it could not
   * read. A tool missing from a partial walk may still be in the project.
   */
  complete: boolean;
  /** Discovery threw or had no catalog to match against. Distinct from finding nothing. */
  failed?: true;
};

/**
 * Discover every catalog tool the walked repo appears to use, including tools
 * the wizard never offers as a warehouse source. Each carries the signals that
 * matched it, for reporting.
 */
export function discoverTools(
  repo: RepoFiles,
  detectors: readonly SourceDetector[],
): DiscoveredTools {
  const signals = signalsFrom(repo);

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
  return { tools: detected, complete: repo.complete };
}

/**
 * Every signal that matches the detector, one per file that holds the name,
 * capped per tool. Packages and script hosts come before `.env` keys: they show
 * the code uses the tool, while a key can outlive it.
 */
function matchDetector(
  detector: SourceDetector,
  signals: ProjectSignals,
): ToolSignal[] {
  const { envKeys, scriptHosts, packages } = detector.signals;
  const matched: ToolSignal[] = [];

  for (const [ecosystem, names] of Object.entries(packages)) {
    const found = signals.packages.get(ecosystem);
    if (!found) continue;
    for (const name of names) {
      for (const file of found.get(name) ?? []) {
        matched.push({ source: ecosystem, name, file });
      }
    }
  }

  for (const host of scriptHosts) {
    for (const file of signals.scriptHosts.get(host) ?? []) {
      matched.push({ source: SCRIPT_HOST_SIGNAL_SOURCE, name: host, file });
    }
  }

  if (envKeys.length > 0) {
    for (const [key, files] of signals.envKeys) {
      if (!envKeys.some((re) => re.test(key))) continue;
      for (const file of files) {
        matched.push({ source: ENV_KEY_SIGNAL_SOURCE, name: key, file });
      }
    }
  }

  return matched.slice(0, MAX_TOOL_EVIDENCE);
}

/** Signal source for a `.env` key name. */
const ENV_KEY_SIGNAL_SOURCE = 'env_key';

/** Signal source for a third-party script hostname found in a template. */
const SCRIPT_HOST_SIGNAL_SOURCE = 'script_host';

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
function describeSignal(signal: ToolSignal): string {
  if (signal.source === ENV_KEY_SIGNAL_SOURCE) {
    return `found \`${signal.name}\` in \`${signal.file ?? '.env'}\``;
  }
  if (signal.source === SCRIPT_HOST_SIGNAL_SOURCE) {
    return `found a \`${signal.name}\` script in \`${
      signal.file ?? 'a template'
    }\``;
  }
  const location =
    PACKAGE_SIGNAL_LOCATIONS[signal.source] ?? `${signal.source} dependencies`;
  return `found \`${signal.name}\` in ${location}`;
}

/**
 * One project's tools: those with a signal at or below `projectPath`, each
 * with only those signals, one per name. `.` is the walked root, which holds
 * every tool. This is how a tool is shown, offered and reported.
 */
export function toolsUnder(
  tools: readonly DetectedTool[],
  projectPath: string,
): DetectedTool[] {
  const prefix = projectPath === '.' ? '' : `${projectPath}/`;
  return tools.flatMap((tool) => {
    const names = new Set<string>();
    const signals: ToolSignal[] = [];
    for (const signal of tool.signals) {
      if (signals.length >= MAX_SIGNALS_PER_TOOL) break;
      if (prefix && signal.file?.startsWith(prefix) !== true) continue;
      // The first file wins for a name several of the project's files hold.
      const name = `${signal.source}\n${signal.name}`;
      if (names.has(name)) continue;
      names.add(name);
      signals.push(signal);
    }
    // The root holds every tool, one with no file to place it by included.
    if (signals.length === 0) return prefix ? [] : [tool];
    return [{ ...tool, signals, matchedSignal: describeSignal(signals[0]) }];
  });
}

/** Every script host the catalog lists; templates are read for them only while it lists some. */
export function catalogScriptHosts(
  detectors: readonly SourceDetector[],
): string[] {
  return [...new Set(detectors.flatMap((d) => d.signals.scriptHosts))];
}

/**
 * Extract KEY NAMES from a dotenv file. Values are intentionally discarded.
 * Re-exported from `@utils/env-scan`, which `check_env_keys` shares, so the
 * walk and the tool cannot disagree about what counts as a key.
 */
export { parseEnvKeyNames as parseEnvKeys } from '@utils/env-scan';
