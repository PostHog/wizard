/**
 * Agentic source-maps detection.
 *
 * Replaces the static filesystem heuristic with a Haiku agent that scans the
 * repo: it finds project roots, resolves monorepo/workspace markers, reads
 * package manifests, classifies each project against the supported source-maps
 * skill variants, and reports which projects already have a PostHog SDK
 * installed. The result is a structured map the picker screen renders so the
 * user can choose which project to instrument.
 *
 * Runs AFTER auth — it drives the same agent loop every program uses, which
 * needs credentials.
 */

import {
  initializeAgent,
  runAgent as executeAgent,
  AgentSignals,
} from '@lib/agent/agent-interface';
import { detectNodePackageManagers } from '@lib/detection/package-manager';
import { getSkillsBaseUrl, HAIKU_MODEL } from '@lib/constants';
import type { WizardSession } from '@lib/wizard-session';
import type { WizardRunOptions } from '@utils/types';
import type { SpinnerHandle } from '@ui';
import {
  VARIANT_DISPLAY_NAME,
  AUTOMATABLE_VARIANTS,
  type SkillVariant,
} from './detect.js';

/** One project the agent found in the repo. */
export type DetectedProject = {
  /** Path relative to the working directory ("." for the repo root). */
  path: string;
  /** Human-readable framework the agent detected (e.g. "Next.js"). */
  framework: string;
  /** A supported source-maps variant when it matches one, else null. */
  variant: SkillVariant | null;
  /** Whether a PostHog SDK is already installed in this project. */
  hasPostHog: boolean;
  /** variant != null && hasPostHog — source-map upload can be wired up here. */
  instrumentable: boolean;
  /** Why the project can't be instrumented (only when !instrumentable). */
  reason?: string;
};

export type DetectionReport = {
  repoType: 'monorepo' | 'single';
  projects: DetectedProject[];
};

/** Streaming progress callback — one short activity line per agent step. */
export type DetectEvent = (line: string) => void;

function buildPrompt(cwd: string): string {
  const supported = AUTOMATABLE_VARIANTS.map(
    (v) => `- ${v} → ${VARIANT_DISPLAY_NAME[v]}`,
  ).join('\n');
  return [
    'You are scanning a code repository to set up PostHog Error Tracking source-map upload.',
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
    '  - the matching supported source-maps variant id (or null if none matches),',
    '  - whether a PostHog SDK (posthog-js, posthog-node, posthog-react-native, posthog-android, posthog-ios, or similar) is already a dependency.',
    '',
    'Supported source-maps variants (id → name):',
    supported,
    '',
    'Output requirements:',
    '- Respond with ONLY a single JSON object. No prose, no markdown code fences.',
    '- Shape: {"repoType":"monorepo"|"single","projects":[{"path":string,"framework":string,"variant":string|null,"hasPostHog":boolean}]}',
    '- "path" is relative to the working directory; use "." for the repo root.',
    '- "variant" MUST be exactly one of the supported ids above when it matches; otherwise null.',
    '- Include projects whose stack is unsupported too (variant: null) so the user can see them.',
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

function coerceVariant(raw: unknown): SkillVariant | null {
  return typeof raw === 'string' &&
    (AUTOMATABLE_VARIANTS as readonly string[]).includes(raw)
    ? (raw as SkillVariant)
    : null;
}

function classify(
  variant: SkillVariant | null,
  hasPostHog: boolean,
): { instrumentable: boolean; reason?: string } {
  if (variant == null) {
    return {
      instrumentable: false,
      reason: "Source-map upload isn't supported for this stack yet",
    };
  }
  if (!hasPostHog) {
    return {
      instrumentable: false,
      reason: 'No PostHog SDK installed yet — run `npx @posthog/wizard` first',
    };
  }
  return { instrumentable: true };
}

/**
 * Validate the agent's raw JSON into a DetectionReport: clamp each variant to
 * the automatable set and classify instrumentability. Exported for testing.
 */
export function coerceReport(parsed: unknown): DetectionReport {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const repoType = obj.repoType === 'monorepo' ? 'monorepo' : 'single';
  const rawProjects = Array.isArray(obj.projects) ? obj.projects : [];
  const projects: DetectedProject[] = rawProjects.map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const variant = coerceVariant(p.variant);
    const hasPostHog = p.hasPostHog === true;
    return {
      path: typeof p.path === 'string' ? p.path : '.',
      framework: typeof p.framework === 'string' ? p.framework : 'Unknown',
      variant,
      hasPostHog,
      ...classify(variant, hasPostHog),
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
export async function detectSourceMapsProjects(
  session: WizardSession,
  onEvent?: DetectEvent,
): Promise<DetectionReport> {
  if (!session.credentials) {
    throw new Error('Detection requires authenticated credentials.');
  }
  const { accessToken, host } = session.credentials;
  const cwd = session.installDir;
  const options = sessionToWizardOptions(session);

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
      integrationLabel: 'source-maps-detect',
      allowedTools: ['Read', 'Grep', 'Glob'],
      modelOverride: HAIKU_MODEL,
    },
    options,
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
    buildPrompt(cwd),
    options,
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

  return coerceReport(extractJson(resultText || collected.join('\n')));
}
