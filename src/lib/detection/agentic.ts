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

export type AgenticDetectOptions = {
  /** Categories to classify each project into. */
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
    `You are scanning a code repository to ${purpose}.`,
    '',
    `Working directory: ${cwd}`,
    '',
    'Scale your effort to the repo — quick for a simple repo, thorough for a monorepo:',
    '',
    '1. Determine whether this is a monorepo. Check the root for workspace markers: a "workspaces" field in package.json, pnpm-workspace.yaml, turbo.json, nx.json, lerna.json, or several sibling app/package directories that each have their own manifest.',
    '2. If it is a SINGLE project: classify the root and finish immediately — do not keep exploring.',
    '3. If it is a MONOREPO: enumerate EVERY app/package (resolve the workspace globs) and classify each. Be thorough — cover all workspaces, not just the first.',
    '',
    'For each project, read only the manifest(s) you need — you do not need to read application source code. Determine:',
    '  - the human-readable framework name (e.g. "Next.js", "Express"),',
    '  - the matching target id below (or null if none matches),',
    '  - whether a PostHog SDK (posthog-js, posthog-node, posthog-react-native, posthog-android, posthog-ios, or similar) is already a dependency.',
    '',
    'Targets (id → name):',
    targetList,
    '',
    'Output requirements:',
    '- Respond with ONLY a single JSON object. No prose, no markdown code fences.',
    '- Shape: {"repoType":"monorepo"|"single","projects":[{"path":string,"framework":string,"targetId":string|null,"hasPostHog":boolean}]}',
    '- "path" is relative to the working directory; use "." for the repo root.',
    '- "targetId" MUST be exactly one of the target ids above when it matches; otherwise null.',
    '- Include projects whose stack matches no target too (targetId: null) so the user can see them.',
    `- If you cannot scan the repo at all, respond with exactly: ${AgentSignals.ABORT} detection failed`,
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

  const mcpUrl = session.localMcp
    ? 'http://localhost:8787/mcp'
    : 'https://mcp.posthog.com/mcp';

  const agent = await initializeAgent(
    {
      workingDirectory: cwd,
      posthogMcpUrl: mcpUrl,
      posthogApiKey: accessToken,
      posthogApiHost: host,
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

  return coerceAgenticReport(
    extractJson(resultText || collected.join('\n')),
    targets.map((t) => t.id),
  );
}
