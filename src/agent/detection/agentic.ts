/**
 * Agentic project detection: drives the wizard's agent loop on HAIKU_MODEL to
 * scan a repo and return the structured report the store's detection
 * contract describes. Installed into the store by the entry point.
 */

import {
  initializeAgent,
  runAgent as executeAgent,
  buildRunTags,
  AgentSignals,
} from '../agent-interface.js';
import { detectNodePackageManagers } from '@store/detection/package-manager';
import {
  CallType,
  getSkillsBaseUrl,
  HAIKU_MODEL,
} from '@store/shared/constants';
import { analytics } from '@store/shared/analytics';
import type { WizardSession } from '@store/session/wizard-session';
import type { WizardRunOptions } from '@store/shared/types';
import type { SpinnerHandle } from '@store/ui';
import {
  coerceAgenticReport,
  deriveReportJson,
  manifestGlob,
  type AgenticDetectOptions,
  type AgenticDetectionReport,
  type DetectTarget,
} from '@store/detection/agentic';

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
    benchmark: session.benchmark,
    yaraReport: session.yaraReport,
    signup: session.signup,
    apiKey: session.apiKey,
    projectId: session.projectId,
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
    programId,
    purpose = 'set up a PostHog integration',
    recommend = false,
    rerankIds,
    onEvent,
  } = options;
  const { accessToken, host } = session.credentials;
  const cwd = session.installDir;
  const runOptions = sessionToWizardOptions(session);

  // Built here rather than inherited: this scan runs before
  // `bootstrapProgram`, so there's no `boot.wizardMetadata` yet.
  const wizardMetadata = {
    ...buildRunTags({
      programId,
      integration: 'agentic-detect',
      runId: analytics.runId,
      build: analytics.build,
    }),
    call_type: CallType.detection,
  };

  const agent = await initializeAgent(
    {
      workingDirectory: cwd,
      posthogMcpUrl: host.mcpUrl,
      posthogApiKey: accessToken,
      host,
      detectPackageManager: detectNodePackageManagers,
      skillsBaseUrl: getSkillsBaseUrl(),
      programId,
      integrationLabel: 'agentic-detect',
      wizardMetadata,
      allowedTools: ['Read', 'Grep', 'Glob'],
      modelOverride: HAIKU_MODEL,
    },
    runOptions,
  );

  // Keeps only the transcript tail — the report JSON is the last output.
  const MAX_TRANSCRIPT_CHARS = 256 * 1024;
  const collected: string[] = [];
  let collectedChars = 0;
  const collect = (text: string): void => {
    collected.push(text);
    collectedChars += text.length;
    while (collectedChars > MAX_TRANSCRIPT_CHARS && collected.length > 1) {
      collectedChars -= collected.shift()!.length;
    }
  };
  let resultText = '';

  const middleware = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onMessage: (message: any): void => {
      if (message?.type === 'assistant') {
        for (const block of message.message?.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            collect(block.text);
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
    buildPrompt(cwd, targets, purpose, recommend),
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

  // Transcript first, final message last — its verdicts win path conflicts.
  const output = `${collected.join('\n')}\n${resultText}`;
  const derived = deriveReportJson(output);
  if (derived === null) {
    // The prompt tells the agent to emit `[ABORT] detection failed` when the
    // repo has no recognizable project manifests. Surface that (and any other
    // non-JSON terminal output that carries the abort signal) as an empty
    // report so the screen renders a friendly "nothing to instrument" state
    // instead of a cryptic "Agent did not return a JSON object" error.
    if (output.includes(AgentSignals.ABORT)) {
      return { repoType: 'single', projects: [] };
    }
    throw new Error('Agent did not return a JSON object');
  }
  return coerceAgenticReport(
    derived,
    targets.map((t) => t.id),
    { recommend, rerankIds },
  );
}
