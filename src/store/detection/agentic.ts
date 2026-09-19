/**
 * Agentic project detection.
 *
 * A reusable detection tool that drives a Haiku agent over the repo: it finds
 * project roots, resolves monorepo/workspace markers, reads package manifests,
 * classifies each project against a caller-supplied set of targets, and reports
 * which projects already have a PostHog SDK installed.
 *
 * Product-knowledge-free by design — the caller passes the targets to classify
 * into (e.g. source-map skill variants) and maps the result back. Sits next to
 * the other detection tools (framework, features, package-manager) so it's
 * discoverable. Runs AFTER auth: it uses the same agent loop every program
 * uses, which needs credentials.
 */

import { isAbsolute, resolve, sep } from 'path';
import type { WizardSession } from '../session/wizard-session.js';

/** A category the agent classifies each project into (id the agent returns). */
export type DetectTarget = { id: string; name: string };

/** One project the agent found in the repo. */
export type AgenticProject = {
  /** Path relative to the working directory ("." for the repo root). */
  path: string;
  /** Human-readable framework the agent detected (e.g. "Next.js"). */
  framework: string;
  /** A target id when the project matches one of the supplied targets, else null. */
  targetId: string | null;
  /** Whether a PostHog SDK is already installed in this project. */
  hasPostHog: boolean;
  /** True on the one project picked as the main user-facing app; only present when the scan set `recommend`. */
  recommended?: boolean;
};

export type AgenticDetectionReport = {
  repoType: 'monorepo' | 'single';
  projects: AgenticProject[];
};

/** Streaming progress callback — one short activity line per agent step. */
export type DetectEvent = (line: string) => void;

/**
 * Every project-manifest / workspace-marker filename the wizard's frameworks
 * are identified by. One brace-expansion Glob over all of these locates every
 * project root in the repo in a single call, regardless of language.
 *
 * Counterpart: POSTHOG_MANIFESTS in @lib/programs/self-driving/detect (SDK
 * grep); keep the two in sync.
 */
export const PROJECT_MANIFESTS: readonly string[] = [
  // JS/TS + workspace markers
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'nx.json',
  'lerna.json',
  // Python
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'Pipfile',
  'manage.py',
  // Ruby / PHP
  'Gemfile',
  'composer.json',
  // Java
  'pom.xml',
  // Rust
  'Cargo.toml',
  // Elixir
  'mix.exs',
  // Go
  'go.mod',
  // .NET: no framework targets yet, but found so
  // an existing PostHog SDK is reported (feeds self-driving's "continue" path).
  '*.csproj',
  // Mobile / native
  'Package.swift',
  'Podfile',
  'project.yml',
  'project.pbxproj',
  'pubspec.yaml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  // Gradle version catalog (holds dependency coordinates).
  'gradle/libs.versions.toml',
];

/** The single brace-expansion glob covering every supported manifest. */
export function manifestGlob(): string {
  return `**/{${PROJECT_MANIFESTS.join(',')}}`;
}

export type AgenticDetectOptions = {
  /**
   * Categories to classify each project into. Order matters: list targets by
   * priority, most specific first. When a project could match more than one,
   * the agent keeps the earliest — so the caller encodes precedence purely
   * through ordering (e.g. a bundler target before a generic framework target).
   */
  targets: readonly DetectTarget[];
  /** The program this scan bills to. Required, not optional: the scan drives a
   *  real agent through the gateway, and a caller that forgets leaves that
   *  spend unattributed. */
  programId: string;
  /** One short clause describing what the scan is for (frames the prompt). */
  purpose?: string;
  /** Ask the agent to label exactly one project `recommended` (the main client app). Off by default. */
  recommend?: boolean;
  /**
   * Target ids whose technologies co-occur in one manifest (e.g. the JS
   * family). Among these, the enumeration's priority winner overrides the
   * model's pick; elsewhere a valid pick always wins — see coerceAgenticReport.
   */
  rerankIds?: readonly string[];
  /** Streaming activity callback for the UI. */
  onEvent?: DetectEvent;
};

export function deriveReportJson(text: string): unknown | null {
  const byPath = new Map<string, Record<string, unknown>>();
  for (const line of text.split('\n')) {
    const start = line.indexOf('{');
    const end = line.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(start, end + 1));
    } catch {
      continue; // not JSON — prose, shape echoes, pretty-printed fragments
    }
    const obj = (parsed ?? {}) as Record<string, unknown>;
    const candidates = Array.isArray(obj.projects) ? obj.projects : [obj];
    for (const candidate of candidates) {
      const p = (candidate ?? {}) as Record<string, unknown>;
      if (typeof p.path === 'string') byPath.set(p.path, p);
    }
  }
  if (byPath.size === 0) return null;
  const projects = [...byPath.values()];
  return { repoType: projects.length > 1 ? 'monorepo' : 'single', projects };
}

/**
 * Clamp an agent-reported project path to a safe repo-relative dir. The path
 * is LLM output: absolute paths or `..` segments could steer later phases
 * (e.g. integrate-run's targetDir) outside the repo, so they clamp to '.'.
 */
function coercePath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return '.';
  if (isAbsolute(raw) || raw.split(/[\\/]/).includes('..')) return '.';
  return raw;
}

/** Resolve an agent-reported path to an absolute dir clamped to the root — the caller-side counterpart of coercePath. */
export function resolveProjectDir(installDir: string, rel: unknown): string {
  if (typeof rel !== 'string' || rel === '.') return installDir;
  const root = resolve(installDir);
  const dir = resolve(root, rel);
  return dir === root || dir.startsWith(root + sep) ? dir : root;
}

/**
 * Validate the agent's raw JSON into a report, clamping each targetId to the
 * supplied set and each path to a repo-relative dir. Exported for testing.
 * `recommended` is stripped unless requested; at most one (the first) survives.
 */
export function coerceAgenticReport(
  parsed: unknown,
  validTargetIds: readonly string[],
  options?: { recommend?: boolean; rerankIds?: readonly string[] },
): AgenticDetectionReport {
  const recommend = options?.recommend === true;
  const rerankIds = options?.rerankIds ?? [];
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const repoType = obj.repoType === 'monorepo' ? 'monorepo' : 'single';
  const rawProjects = Array.isArray(obj.projects) ? obj.projects : [];
  let recommendedSeen = false;
  const projects: AgenticProject[] = rawProjects.map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    // Trust the model's pick; an invalid one falls back to the enumeration's
    // highest-priority member (validTargetIds IS the priority order). The
    // winner overrides a valid pick only when both sit in rerankIds — stacks
    // that co-occur in one manifest, where a misordered enumeration is the
    // common miss. Elsewhere enumerations are padded across exclusive stacks
    // (a Flutter app listing react-native) and must not beat a correct pick.
    const pick =
      typeof p.targetId === 'string' && validTargetIds.includes(p.targetId)
        ? p.targetId
        : null;
    const enumerated = Array.isArray(p.matchingTargets)
      ? validTargetIds.find((id) =>
          (p.matchingTargets as unknown[]).includes(id),
        ) ?? null
      : null;
    const targetId =
      pick === null
        ? enumerated
        : enumerated !== null &&
          rerankIds.includes(enumerated) &&
          rerankIds.includes(pick)
        ? enumerated
        : pick;
    const recommended = recommend && !recommendedSeen && p.recommended === true;
    recommendedSeen ||= recommended;
    return {
      path: coercePath(p.path),
      framework: typeof p.framework === 'string' ? p.framework : 'Unknown',
      targetId,
      hasPostHog: p.hasPostHog === true,
      ...(recommend ? { recommended } : {}),
    };
  });
  return { repoType, projects };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

/** Runs the detection agent. The agent surface provides it; the entry point installs it. */
export type DetectProjectsWithAgent = (
  session: WizardSession,
  options: AgenticDetectOptions,
) => Promise<AgenticDetectionReport>;

let detectionAgent: DetectProjectsWithAgent | null = null;

export function setDetectionAgent(fn: DetectProjectsWithAgent): void {
  detectionAgent = fn;
}

export function detectProjectsWithAgent(
  session: WizardSession,
  options: AgenticDetectOptions,
): Promise<AgenticDetectionReport> {
  if (!detectionAgent) throw new Error('detection agent not installed');
  return detectionAgent(session, options);
}
