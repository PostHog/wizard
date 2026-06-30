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

import {
  initializeAgent,
  runAgent as executeAgent,
  AgentSignals,
} from '@lib/agent/agent-interface';
import { detectNodePackageManagers } from './package-manager.js';
import { getSkillsBaseUrl, HAIKU_MODEL } from '@lib/constants';
import type { WizardSession } from '@lib/wizard-session';
import type { WizardRunOptions } from '@utils/types';
import type { SpinnerHandle } from '@ui';

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
  // Rust / Go
  'Cargo.toml',
  'go.mod',
  // Mobile / native
  'Package.swift',
  'Podfile',
  'pubspec.yaml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
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
  /** One short clause describing what the scan is for (frames the prompt). */
  purpose?: string;
  /** Streaming activity callback for the UI. */
  onEvent?: DetectEvent;
};

function buildPrompt(
  cwd: string,
  targets: readonly DetectTarget[],
  purpose: string,
): string {
  const targetList = targets.map((t) => `- ${t.id} → ${t.name}`).join('\n');
  return [
    `You are scanning a code repository to ${purpose}. Be fast and mechanical — do not over-explore. Keep any reasoning to one short sentence, then run the tool calls and output the JSON.`,
    '',
    `Working directory: ${cwd}`,
    '',
    'A "project" is a directory containing one or more of the manifest files below. Find projects by their manifests, NOT by walking directories — never report a directory that has no manifest.',
    '',
    'Do exactly this:',
    `1. Run Glob ONCE with this pattern to find every project manifest in the repo in a single call: "${manifestGlob()}". Discard any result whose path contains node_modules/, dist/, build/, .next/, out/, coverage/, vendor/, .venv/, site-packages/, or target/. Group the remaining results by directory — each directory is one project.`,
    '2. Decide repoType: "monorepo" if the root package.json has a "workspaces" field OR a pnpm-workspace.yaml / turbo.json / nx.json / lerna.json was found at the root, else "single".',
    '3. For EACH project directory, Read its manifest(s) ONCE. From the dependency lists decide:',
    '   - the human-readable framework name (e.g. "Next.js", "Django", "Rails"),',
    '   - the matching target id from the list below. That list is ordered by priority — most specific first — so when a project could match more than one target (e.g. it uses several of the listed technologies), pick the one listed EARLIEST. Use null only if none matches,',
    '   - hasPostHog: true if any dependency is a PostHog SDK (name contains "posthog", e.g. posthog-js, posthog-node, @posthog/*, posthog (pip/gem)), else false.',
    '   Do NOT read any file other than these manifests.',
    '',
    'Target ids (id → name), in priority order — most specific first; if several match a project, keep the one listed earliest:',
    targetList,
    '',
    'Output requirements:',
    '- Respond with ONLY a single JSON object. No prose, no markdown code fences.',
    '- Shape: {"repoType":"monorepo"|"single","projects":[{"path":string,"framework":string,"targetId":string|null,"hasPostHog":boolean}]}',
    '- "path" is the project directory relative to the working directory; use "." for the repo root.',
    '- "targetId" MUST be exactly one of the target ids above when it matches; if several match, use the one listed earliest; otherwise null.',
    '- Include projects whose stack matches no target too (targetId: null).',
    `- If there are no manifests at all, respond with exactly: ${AgentSignals.ABORT} detection failed`,
  ].join('\n');
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Agent did not return a JSON object');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Validate the agent's raw JSON into a report, clamping each targetId to the
 * supplied set. Exported for testing.
 */
export function coerceAgenticReport(
  parsed: unknown,
  validTargetIds: readonly string[],
): AgenticDetectionReport {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const repoType = obj.repoType === 'monorepo' ? 'monorepo' : 'single';
  const rawProjects = Array.isArray(obj.projects) ? obj.projects : [];
  const projects: AgenticProject[] = rawProjects.map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const targetId =
      typeof p.targetId === 'string' && validTargetIds.includes(p.targetId)
        ? p.targetId
        : null;
    return {
      path: typeof p.path === 'string' ? p.path : '.',
      framework: typeof p.framework === 'string' ? p.framework : 'Unknown',
      targetId,
      hasPostHog: p.hasPostHog === true,
    };
  });
  return { repoType, projects };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatToolUse(block: any): string {
  const name = typeof block?.name === 'string' ? block.name : 'tool';
  const input = (block?.input ?? {}) as Record<string, unknown>;
  const detail =
    (input.file_path as string) ||
    (input.pattern as string) ||
    (input.path as string) ||
    '';
  return detail ? `${name} ${detail}` : name;
}

function sessionToWizardOptions(session: WizardSession): WizardRunOptions {
  return {
    installDir: session.installDir,
    ci: session.ci,
    debug: session.debug,
    default: false,
    benchmark: session.benchmark,
    yaraReport: session.yaraReport,
    signup: session.signup,
    apiKey: session.apiKey,
    projectId: session.projectId,
    localMcp: session.localMcp,
  };
}

const NOOP_SPINNER: SpinnerHandle = {
  start: () => undefined,
  stop: () => undefined,
  message: () => undefined,
};

/**
 * Drive the wizard's agent loop on HAIKU_MODEL to scan the repo and return a
 * structured detection report. Reuses the same setup every program uses, so
 * MCP, tools, and credentials are wired identically.
 */
export async function detectProjectsWithAgent(
  session: WizardSession,
  options: AgenticDetectOptions,
): Promise<AgenticDetectionReport> {
  if (!session.credentials) {
    throw new Error('Detection requires authenticated credentials.');
  }
  const {
    targets,
    purpose = 'set up a PostHog integration',
    onEvent,
  } = options;
  const { accessToken, host } = session.credentials;
  const cwd = session.installDir;
  const runOptions = sessionToWizardOptions(session);

  const agent = await initializeAgent(
    {
      workingDirectory: cwd,
      posthogMcpUrl: host.mcpUrl,
      posthogApiKey: accessToken,
      host,
      detectPackageManager: detectNodePackageManagers,
      skillsBaseUrl: getSkillsBaseUrl(session.localMcp),
      integrationLabel: 'agentic-detect',
      allowedTools: ['Read', 'Grep', 'Glob'],
      modelOverride: HAIKU_MODEL,
    },
    runOptions,
  );

  const collected: string[] = [];
  let resultText = '';

  const middleware = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onMessage: (message: any): void => {
      if (message?.type === 'assistant') {
        for (const block of message.message?.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            collected.push(block.text);
            const line = block.text.trim();
            if (line && onEvent) {
              onEvent(line.length > 100 ? `${line.slice(0, 100)}…` : line);
            }
          } else if (block?.type === 'tool_use') {
            onEvent?.(formatToolUse(block));
          }
        }
      } else if (
        message?.type === 'result' &&
        typeof message.result === 'string'
      ) {
        resultText = message.result;
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    finalize: (_resultMessage: any, _durationMs: number): unknown => undefined,
  };

  const result = await executeAgent(
    agent,
    buildPrompt(cwd, targets, purpose),
    runOptions,
    NOOP_SPINNER,
    {
      spinnerMessage: 'Scanning the repo...',
      successMessage: 'Detection complete',
      errorMessage: 'Detection failed',
      requestRemark: false,
    },
    middleware,
  );

  if (result.error) {
    throw new Error(result.message || `Agent error: ${result.error}`);
  }

  const output = resultText || collected.join('\n');
  try {
    return coerceAgenticReport(
      extractJson(output),
      targets.map((t) => t.id),
    );
  } catch (err) {
    // The prompt tells the agent to emit `[ABORT] detection failed` when the
    // repo has no recognizable project manifests. Surface that (and any other
    // non-JSON terminal output that carries the abort signal) as an empty
    // report so the screen renders a friendly "nothing to instrument" state
    // instead of a cryptic "Agent did not return a JSON object" error.
    if (output.includes(AgentSignals.ABORT)) {
      return { repoType: 'single', projects: [] };
    }
    throw err;
  }
}
