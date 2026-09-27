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
 * discoverable. Runs AFTER auth: it goes through the same `runAgent` every
 * program uses, which needs credentials.
 */

import { AgentSignals, buildRunTags, runAgent, RunOutcome } from '@agent';
import type {
  AgentProgress,
  AgentRunDefinition,
  ResolvedBinding,
  RunConfig,
  RunInput,
} from '@agent/types';
import { isAbsolute, resolve, sep } from 'path';
import { detectNodePackageManagers } from './package-manager.js';
import {
  AGENTIC_DETECTION_FIRST_ATTEMPT_TIMEOUT_MS,
  AGENTIC_DETECTION_RETRY_TIMEOUT_MS,
  CallType,
  getSkillsBaseUrl,
  Harness,
  HAIKU_MODEL,
  POSTHOG_DOCS_URL,
  Sequence,
} from '@shared/constants';
import { analytics } from '@utils/analytics';
import type { WizardSession } from '@lib/wizard-session';
import { getUI } from '@ui';
import { createUiReducer } from '@ui/agent-progress';

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

export class AgenticDetectionTimeoutError extends Error {
  constructor(attempt: number, timeoutMs: number) {
    super(
      `Project scan attempt ${attempt} timed out after ${timeoutMs / 1000}s`,
    );
    this.name = 'AgenticDetectionTimeoutError';
  }
}

/** Streaming progress callback — one short activity line per agent step. */
export type DetectEvent = (line: string) => void;

/**
 * Every project-manifest / workspace-marker filename the wizard's frameworks
 * are identified by. One brace-expansion Glob over all of these locates every
 * project root in the repo in a single call, regardless of language.
 *
 * Counterpart: POSTHOG_MANIFESTS in @programs/self-driving/detect (SDK
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

function buildPrompt(
  cwd: string,
  targets: readonly DetectTarget[],
  purpose: string,
  recommend: boolean,
): string {
  const targetList = targets.map((t) => `- ${t.id} → ${t.name}`).join('\n');
  // matchingTargets precedes targetId: the model enumerates before it picks.
  const projectShape = `{"path":string,"framework":string,"matchingTargets":string[],"targetId":string|null,"hasPostHog":boolean,"evidence":string${
    recommend ? ',"recommended":boolean' : ''
  }}`;
  return [
    `You are scanning a code repository to ${purpose}. Be fast and mechanical — do not over-explore. Keep any reasoning to one short sentence, then run the tool calls and output the JSON.`,
    '',
    `Working directory: ${cwd}`,
    '',
    'A "project" is a directory containing one or more of the manifest files below. Find projects by their manifests, NOT by walking directories — never report a directory that has no manifest.',
    '',
    'Do exactly this:',
    `1. Run Glob ONCE with this pattern to find every project manifest in the repo in a single call: "${manifestGlob()}". Discard any result whose path contains node_modules/, dist/, build/, .next/, out/, coverage/, vendor/, .venv/, site-packages/, target/, Pods/, Carthage/, or DerivedData/. Group the remaining results by directory — each directory is one project. Three exceptions to "directory = project": a project.pbxproj lives inside a "<Name>.xcodeproj/" wrapper, so the project root is the PARENT of that .xcodeproj directory; a project.yml at a directory root is an XcodeGen-generated Xcode app rooted at that directory; a gradle/libs.versions.toml is a version catalog belonging to the gradle project rooted at the PARENT of that gradle/ directory (read it alongside the build.gradle when deciding hasPostHog), never its own project.`,
    '2. Decide repoType: "monorepo" if the root package.json has a "workspaces" field OR a pnpm-workspace.yaml / turbo.json / nx.json / lerna.json was found at the root, else "single".',
    `3. For EACH project directory, ONE AT A TIME: Read its manifest(s) ONCE, decide the fields below, then IMMEDIATELY — before reading any other project — write that project's verdict as one JSON line of shape ${projectShape}. Never write a verdict from memory of an earlier Read; the manifest you just read is the only source. Decide from its dependency lists:`,
    '   - the human-readable framework name (e.g. "Next.js", "Django", "Rails"),',
    '   - matchingTargets: EVERY target id from the list below whose technology appears in THIS manifest, in the priority order of the list. An id belongs here only if you can point at the dependency or setting in the manifest you just read — never carry one over from another project,',
    '   - targetId: the FIRST entry of matchingTargets (the list is ordered by priority, most specific first). null when matchingTargets is empty,',
    `   - hasPostHog: true if any dependency is a PostHog SDK. This includes: a name containing "posthog" in any ecosystem (e.g. posthog-js, posthog-node, @posthog/*, posthog for pip/gem/hex, a com.posthog:* gradle/maven coordinate, a PostHog NuGet PackageReference); an SPM package named "PostHog" or a repositoryURL of github.com/PostHog/posthog-ios (in Package.swift or a .pbxproj); or a "pod 'PostHog'" line in a Podfile. Else false.`,
    '   - evidence: the manifest fact that decided targetId, with the file it came from (e.g. "rollup in devDependencies of backend/package.json"). When targetId is null, name the closest fact you saw. One short clause, quoted from the manifest you just read.',
    '   Do NOT read any file other than these manifests.',
    ...(recommend
      ? [
          '4. Pick exactly ONE project as recommended — the main user-facing client application. Prefer a frontend web app or a mobile app over backend servers/APIs, libraries, CLIs, tooling, and example/demo/docs apps. If several client apps exist, pick the primary production app; if no client app exists, pick the primary application project.',
        ]
      : []),
    '',
    'Target ids (id → name), in priority order — most specific first; if several match a project, keep the one listed earliest:',
    targetList,
    '',
    'Output requirements:',
    '- After the last verdict line, respond with ONLY a single JSON object assembling the verdict lines you wrote, copied VERBATIM — same path, framework, targetId and evidence per project. No prose, no markdown code fences.',
    `- Shape: {"repoType":"monorepo"|"single","projects":[${projectShape}]}`,
    '- "path" is the project directory relative to the working directory; use "." for the repo root.',
    '- "targetId" MUST be exactly one of the target ids above when it matches; if several match, use the one listed earliest; otherwise null.',
    '- Include projects whose stack matches no target too (targetId: null).',
    ...(recommend
      ? [
          '- Exactly one project has "recommended": true; every other project has "recommended": false.',
        ]
      : []),
    `- If there are no manifests at all, respond with exactly: ${AgentSignals.ABORT} detection failed`,
  ].join('\n');
}

/**
 * Build the detection report from the agent's output, or null when it holds
 * no verdicts. Exported for testing.
 *
 * The verdict lines are far more reliable than the model's final assembly
 * (prose, pretty-printing, per-object fences), so every parseable line
 * contributes: objects with a `path` merge by path (last wins), and a
 * one-line assembly's `projects` merge the same way. `repoType` is
 * approximated from the count — it only feeds telemetry and display.
 */
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

/** A fast mechanical scan: linear Haiku on the Anthropic harness. */
const AGENTIC_DETECTION_BINDING: ResolvedBinding = {
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: HAIKU_MODEL,
};

/** No skill and no remark; the report is read back from the transcript tail. */
function detectionRunDefinition(prompt: string): AgentRunDefinition {
  return {
    integrationLabel: 'agentic-detect',
    prompt: () => prompt,
    collectTranscript: true,
    requestRemark: false,
    detectPackageManager: detectNodePackageManagers,
    spinnerMessage: 'Scanning the repo...',
    successMessage: 'Detection complete',
    errorMessage: 'Detection failed',
    estimatedDurationMinutes: 1,
    reportFile: '',
    docsUrl: POSTHOG_DOCS_URL,
  };
}

/** What the UI saw before `runAgent`: no run lifecycle, spinner, outro, or setup logs below warn. */
function reachesUi(event: AgentProgress): boolean {
  switch (event.kind) {
    case 'lifecycle':
    case 'completion':
    case 'spinner':
      return false;
    case 'log':
      return event.level === 'warn' || event.level === 'error';
    default:
      return true;
  }
}

/** Scan the repo with Haiku through `runAgent`; each attempt is a fresh run with its own deadline. */
export async function detectProjectsWithAgent(
  session: WizardSession,
  options: AgenticDetectOptions,
): Promise<AgenticDetectionReport> {
  if (!session.credentials) {
    throw new Error('Detection requires authenticated credentials.');
  }
  const {
    targets,
    programId,
    purpose = 'set up a PostHog integration',
    recommend = false,
    rerankIds,
    onEvent,
  } = options;

  // Built here: the scan runs before the program's own run tags exist.
  const wizardMetadata = {
    ...buildRunTags({
      programId,
      integration: 'agentic-detect',
      runId: analytics.runId,
      build: analytics.build,
    }),
    call_type: CallType.detection,
  };
  const config: RunConfig = {
    programId,
    run: detectionRunDefinition(
      buildPrompt(session.installDir, targets, purpose, recommend),
    ),
    composed: true,
    binding: AGENTIC_DETECTION_BINDING,
    // Only the orchestrator reads it; the scan is linear.
    switchboard: {
      program: programId,
      composed: true,
      flags: {},
      flagPayloads: {},
    },
    skillsBaseUrl: getSkillsBaseUrl(),
    wizardFlags: {},
    wizardFlagPayloads: {},
    wizardMetadata,
    allowedTools: ['Read', 'Grep', 'Glob'],
    // The scan's scans count toward the program run's report.
    scanReport: 'defer',
  };
  const input: RunInput = {
    installDir: session.installDir,
    credentials: session.credentials,
    project: null,
    apiUser: null,
    // No benchmark pipeline and no AIO capture: the scan never had either.
    flags: {
      ci: session.ci,
      signup: session.signup,
      debug: session.debug,
      e2eAsk: false,
      localMcp: false,
      captureAio: false,
      benchmark: false,
      yaraReport: session.yaraReport,
    },
    host: { projectId: session.projectId, apiKey: session.apiKey },
  };
  const reduceUi = createUiReducer(getUI());
  const forward = (event: AgentProgress): void => {
    if (event.kind === 'activity') onEvent?.(event.line);
    if (reachesUi(event)) reduceUi(event);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const timeoutMs =
      attempt === 0
        ? AGENTIC_DETECTION_FIRST_ATTEMPT_TIMEOUT_MS
        : AGENTIC_DETECTION_RETRY_TIMEOUT_MS;
    const deadline = AbortSignal.timeout(timeoutMs);
    const result = await runAgent(config, input, {
      signal: deadline,
      onProgress: forward,
    });

    if (result.outcome === RunOutcome.Aborted && deadline.aborted) {
      if (attempt === 0) {
        onEvent?.('Project scan timed out; retrying...');
        continue;
      }
      throw new AgenticDetectionTimeoutError(attempt + 1, timeoutMs);
    }
    if (result.outcome !== RunOutcome.Success) {
      throw result.failure.error ?? new Error(result.failure.message);
    }

    // Transcript first, final message last — its verdicts win path conflicts.
    const output = result.snapshot.transcriptTail ?? '';
    const derived = deriveReportJson(output);
    if (derived !== null) {
      return coerceAgenticReport(
        derived,
        targets.map((t) => t.id),
        { recommend, rerankIds },
      );
    }
    // No manifests are a valid empty scan, not a reason to retry.
    if (output.includes(AgentSignals.ABORT)) {
      return { repoType: 'single', projects: [] };
    }
    if (attempt === 0) onEvent?.('Retrying project scan...');
  }
  throw new Error('Agent did not return a JSON object after retry');
}
