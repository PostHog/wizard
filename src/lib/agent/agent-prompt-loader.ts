/**
 * Agent-prompt loader + registry.
 *
 * Agent prompts are the WHAT of a task: a markdown file per type, served from
 * context-mill as the `agents` content type (parallel to skills). The frontmatter
 * carries the artifacts the executor needs — model, the mini-skills to load (the
 * HOW), the tools the task may use, and its dependencies — and the body is the
 * instruction the agent reads.
 *
 * The registry is fetched once at startup and scoped to one flow — agents
 * declare `flow` and (for the planner) `seed: true` in frontmatter, so each
 * program (integration, audit, migration, ...) ships its own agent set and the
 * loader stays generic. Every prompt is downloaded and parsed up front, so
 * resolving a task to its run config is synchronous and adds no mid-drain
 * network latency. The registry's type list also drives `enqueue_task`
 * validation.
 */
import type {
  QueueStore,
  QueuedTask,
} from './runner/sequence/orchestrator/queue';
import type { ResolvedTask } from './runner/sequence/orchestrator/executor';
import type { HostResolution } from '@lib/host-resolution';
import {
  isThinkingLevel,
  type ThinkingLevel,
} from './runner/switchboard/models';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { fetchWithRetry } from '@lib/fetch-retry';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools/tools';

/**
 * The basics the client injects around every agent-prompt body. The `/agents/`
 * files carry intent only (goal, success criteria); the wizard owns the I/O
 * contract — who the agent is, how it reports, how it surfaces progress — so the
 * authored prompts never restate it.
 */
export interface OrchestratorPromptContext {
  projectId: number;
  projectApiKey: string;
  host: HostResolution;
  /** Path to the framework's reference implementation (EXAMPLE.md), if available. */
  examplePath?: string;
  /** Path to the framework's rules (COMMANDMENTS.md), if available. */
  commandmentsPath?: string;
}

function projectContext(ctx: OrchestratorPromptContext): string {
  // Both hosts, distinctly labelled: `apiHost` is the ingestion/API origin the
  // SDK talks to, `appHost` the user-facing web app. A task that hands the user
  // a link (e.g. the data-warehouse new-source fallback) must build it from the
  // app host — the ingestion host does not serve those pages.
  return `You have access to the PostHog MCP server and the wizard tools.

Project context:
- PostHog Project ID: ${ctx.projectId}
- PostHog public token: ${ctx.projectApiKey}
- PostHog Host: ${ctx.host.apiHost}
- PostHog app URL (base for any link you show the user in a browser): ${ctx.host.appHost}`;
}

/** Points the agent at the framework's reference integration to learn patterns from. */
function exampleReference(ctx: OrchestratorPromptContext): string | null {
  if (!ctx.examplePath) return null;
  return `A reference PostHog integration for this framework is at \`${ctx.examplePath}\`. It shows the target implementation pattern. Reference its patterns and conventions, adapting them to this codebase.`;
}

/** The framework's rules ship with the reference skill; every task follows them. */
function commandmentsReference(ctx: OrchestratorPromptContext): string | null {
  if (!ctx.commandmentsPath) return null;
  return `Framework rules for this integration are at \`${ctx.commandmentsPath}\`. Read them before you edit and follow them.`;
}

/**
 * The task's own tool list, injected so an agent never has to discover a tool's
 * absence by trying it — and never reports that absence as a finding. Later
 * tasks hold tools this one does not, so work it cannot do is handed on rather
 * than attempted.
 */
/** Renders the inventory from the tool names a harness actually registered for
 *  the run — the one complete list, in the vocabulary the agent will call. */
export function renderToolInventory(toolNames: readonly string[]): string {
  if (toolNames.length === 0) return '';
  return `Your tools for this task: ${toolNames.join(
    ', ',
  )}. Do not look for a tool that is not listed or treat its absence as a problem to report. Later tasks in this run hold tools you do not: when your task needs one, hand that work off in your handoff for the task that can do it, or note it for the final report.`;
}

const TASK_BASICS = `You are one step in a larger PostHog workflow made of several tasks, run as a fresh agent with no memory of the other tasks beyond the context you are given. Other tasks — before and after you — own the rest of the work, so stay strictly on your own task: do not do a neighbouring step's job, redo what an upstream handoff already did, or reach beyond what you were asked. Do only your task, then report exactly once by calling complete_task with a structured handoff: what your goal was, what you did, and what the next agent should know. When you are given context from previous steps, trust it — those agents already did their work, so do not re-verify or re-read what their handoffs tell you. Build on it and move fast. Read a file before you edit it, so your own changes do not duplicate what is already there. Work only inside this project's own directory: never read, list, or search (find, ls, grep, glob) outside it — not the OS, not other projects, not global package caches. If your task seems to need something outside this directory, it does not — skip that part and say so in your handoff rather than hunting across the filesystem. If your task does not apply to this project — there is genuinely nothing for it to do — report it with status \`not needed\` and say why, rather than marking it done.`;

const SEED_BASICS = `You are the orchestrator. Plan the work and seed the queue with enqueue_task — each call returns an id you can pass as a dependency to a later task. Give each task a short label for the UI — the action in a few words, not file names, class names, or other specifics. The last task you queue, the one that reports on the run, must depend on every other task in the queue — directly, or through a task it already depends on. You are not a task yourself: do not call complete_task and do not edit the project.`;

/**
 * Tasks the wizard queued before the planner ran. It has to see them: they are
 * part of the run it is planning around, and the task that reports last has to
 * depend on them. Their ids are real, so it can wire the edge directly.
 *
 * The one-way rule matters as much as the sink edge. These tasks are deferred to
 * the end of the drain after planning (`seeded-deps.ts`) and may block on a
 * person, so a task the planner hangs off one would wait on the user too — which
 * is the interruption deferring them removed. The resolver drops such a task
 * from the seeded task's own dependencies to stay acyclic, so the damage is
 * silent; saying so here is what prevents it.
 */
function preQueuedTasks(
  tasks: readonly { id: string; type: string }[],
): string | null {
  if (tasks.length === 0) return null;
  const lines = tasks.map((t) => `- ${t.type} (id: ${t.id})`);
  return `The queue already holds these tasks, placed by the wizard from what it found in this project. Do not queue them again. They run late — after every task you queue — and one may stop to ask the user for input, so make the reporting task depend on each one and hang nothing else off them: any other task you made depend on one would end up waiting on a person.\n${lines.join(
    '\n',
  )}`;
}

/**
 * Points the agent at its installed task instructions (the HOW). They live under
 * the wizard's run dir, not `.claude/skills/`, so the SDK does not auto-load
 * them — the prompt has to name them.
 */
function skillReference(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const list = paths.map((p) => `\`${p}\``).join(', ');
  return `Your task instructions are at ${list}. Read them before you start and follow them. They are wizard scaffolding, not part of the project.`;
}

/** A task agent's full prompt: injected basics, then the authored intent. */
export function assembleTaskPrompt(
  ctx: OrchestratorPromptContext,
  body: string,
  skillPaths: readonly string[] = [],
): string {
  return [
    projectContext(ctx),
    exampleReference(ctx),
    commandmentsReference(ctx),
    skillReference(skillPaths),
    TASK_BASICS,
    body,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The seed agent's full prompt: injected basics, then the authored intent. */
export function assembleSeedPrompt(
  ctx: OrchestratorPromptContext,
  body: string,
  preQueued: readonly { id: string; type: string }[] = [],
): string {
  return [projectContext(ctx), SEED_BASICS, preQueuedTasks(preQueued), body]
    .filter(Boolean)
    .join('\n\n');
}

/** Orchestrator tools are MCP tools under the `posthog-wizard` server. Frontmatter
 *  names them short (e.g. `enqueue_task`); the SDK gates on the full name. */
const ORCHESTRATOR_TOOL_PREFIX = 'mcp__posthog-wizard__';
const ORCHESTRATOR_TOOLS = new Set([
  'enqueue_task',
  'complete_task',
  'read_handoffs',
]);

/** The one tool that stops a task until a person answers. Named short in frontmatter. */
export const ASK_TOOL = 'wizard_ask';

/** The skill-menu tools, as agents ask for them in frontmatter. */
const SKILL_MENU_TOOL = 'load_skill_menu';
const INSTALL_SKILL_TOOL = 'install_skill';

/**
 * The PostHog MCP, as an agent asks for it in frontmatter. Every tool a task
 * gets is granted by its own prompt, this one included: a task that never names
 * it never has the server wired in, and one that does gets it under this name
 * on both harnesses.
 */
export const POSTHOG_MCP_TOOL = 'posthog_exec';
/** The same tool as the anthropic SDK names it, on the hosted PostHog server. */
const POSTHOG_MCP_SDK_TOOL = 'mcp__posthog-wizard__exec';

/** Whether a task asked for the PostHog MCP — accepts either spelling. */
export function allowsPostHogMcp(
  allowedTools: readonly string[] | undefined,
): boolean {
  return (allowedTools ?? []).some(
    (name) => name === POSTHOG_MCP_TOOL || name === POSTHOG_MCP_SDK_TOOL,
  );
}

/** The queue tools a task holds — all of them minus its disallows. Short names.
 *  Single source for both the injected inventory and the harness's tool grant. */
export function queueTools(disallowedTools: readonly string[]): string[] {
  const disallowed = new Set(
    disallowedTools.map((n) => n.replace(ORCHESTRATOR_TOOL_PREFIX, '')),
  );
  return [...ORCHESTRATOR_TOOLS].filter((t) => !disallowed.has(t));
}

/** A parsed agent prompt. The frontmatter fields plus the markdown body. */
export interface AgentPrompt {
  type: string;
  /** Human-readable title for the TUI; falls back to `type` when absent. */
  label?: string;
  /** The flow this agent belongs to (the program id, e.g. \`posthog-integration\`). */
  flow?: string;
  /** Marks the flow's planner: it seeds the queue and is not an enqueueable task. */
  seed: boolean;
  /** Marks a task that runs last: it must depend on every other task in the queue. */
  sink: boolean;
  /**
   * Marks a task only the wizard may queue. The planner never sees the type, so
   * whether it runs is a decision the client makes from what it detected, not
   * one an agent can reach — it can neither invent the task nor forget it.
   */
  runnerSeeded: boolean;
  /** Per-profile model + effort. `pi` = the gpt/pi harness, `sdk` = the anthropic
   * harness. The mapping is not 1:1 across providers, so each agent names both. */
  modelPi?: string;
  effortPi?: ThinkingLevel;
  modelSdk?: string;
  effortSdk?: ThinkingLevel;
  skills: string[];
  allowedTools: string[];
  disallowedTools: string[];
  /**
   * Task types this one runs after. Read differently by the two kinds of task:
   *
   * - **Enqueueable types**: advisory. The planner authors the real graph with
   *   `enqueue_task`, passing ids, and its seed prompt describes the shape it
   *   should build. Nothing resolves this field for them.
   * - **`runnerSeeded` types**: authoritative. Such a task is queued before the
   *   planner runs, so it cannot name ids; the runner resolves these types to
   *   the ids the planner produced and applies them (see `seeded-deps.ts`).
   *   Empty means "after everything that is not the sink".
   */
  dependsOn: string[];
  body: string;
}

/** The model + effort an agent runs on for a given harness — `pi` picks the gpt
 * column, anything else the sdk (anthropic) column. */
export function promptModelFor(
  prompt: AgentPrompt,
  harness: string,
): { model?: string; effort?: ThinkingLevel } {
  const pi = harness === 'pi';
  return {
    model: pi ? prompt.modelPi : prompt.modelSdk,
    effort: pi ? prompt.effortPi : prompt.effortSdk,
  };
}

export interface AgentRegistry {
  /** The flow's task types — every prompt except the seed. */
  readonly types: string[];
  /** The types an agent may enqueue: `types` minus the runner-seeded ones. */
  readonly enqueueableTypes: string[];
  /** The types that run last and must depend on the whole queue. */
  readonly sinkTypes: string[];
  /** The types only the wizard queues, from what it detected before the run. */
  readonly runnerSeededTypes: string[];
  /** The flow's planner, the one prompt marked `seed: true` in its frontmatter. */
  readonly seed?: AgentPrompt;
  get(type: string): AgentPrompt | undefined;
}

/** The registry for one flow's prompts. Pure; the loader feeds it the fetched set. */
export function buildRegistry(
  prompts: readonly AgentPrompt[],
  flow: string,
  opts?: {
    exclude?: readonly string[];
    /** Per-stage pi model/effort overlays, keyed by task type ('seed' for the planner). Applied here — the one place prompts enter the wizard — so every downstream read sees the effective spec. */
    overrides?: Record<
      string,
      { model?: string; effort?: ThinkingLevel } | undefined
    >;
  },
): AgentRegistry {
  // The harness can exclude task types (CI excludes dashboards). An excluded
  // type does not exist for the run: the seed cannot enqueue it and no agent
  // is ever spun up for it.
  const excluded = new Set(opts?.exclude ?? []);
  const inFlow = prompts
    .filter((p) => p.flow === flow && !excluded.has(p.type))
    .map((p) => {
      const o = opts?.overrides?.[p.seed ? 'seed' : p.type];
      if (!o) return p;
      return {
        ...p,
        modelPi: o.model ?? p.modelPi,
        effortPi: o.effort ?? p.effortPi,
      };
    });
  const byType = new Map(inFlow.map((p) => [p.type, p]));
  const tasks = inFlow.filter((p) => !p.seed);
  return {
    types: tasks.map((p) => p.type),
    enqueueableTypes: tasks.filter((p) => !p.runnerSeeded).map((p) => p.type),
    sinkTypes: tasks.filter((p) => p.sink).map((p) => p.type),
    runnerSeededTypes: tasks.filter((p) => p.runnerSeeded).map((p) => p.type),
    seed: inFlow.find((p) => p.seed),
    get: (type) => byType.get(type),
  };
}

interface AgentMenu {
  /** `flow` arrived with context-mill's flow-scoped agents folder; older menus omit it. */
  agents: { id: string; flow?: string; downloadUrl: string }[];
}

/** A native tool passes through; an MCP tool gets its fully-qualified name. */
function expandToolName(name: string): string {
  if (name === ASK_TOOL) return WIZARD_TOOL_NAMES.wizardAsk;
  if (name === SKILL_MENU_TOOL) return WIZARD_TOOL_NAMES.loadSkillMenu;
  if (name === INSTALL_SKILL_TOOL) return WIZARD_TOOL_NAMES.installSkill;
  if (name === POSTHOG_MCP_TOOL) return POSTHOG_MCP_SDK_TOOL;
  return ORCHESTRATOR_TOOLS.has(name)
    ? `${ORCHESTRATOR_TOOL_PREFIX}${name}`
    : name;
}

/** A prompt's allow/disallow lists with orchestrator tool names MCP-qualified. */
export function agentRunTools(prompt: AgentPrompt): {
  allowedTools: string[];
  disallowedTools: string[];
} {
  return {
    allowedTools: prompt.allowedTools.map(expandToolName),
    disallowedTools: prompt.disallowedTools.map(expandToolName),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Parse the leading `---` frontmatter block and the markdown body. The
 * frontmatter is a small, known schema (scalars and inline `[a, b]` arrays), so
 * a tiny parser covers it without a YAML dependency. Inline `# comments` after a
 * value are stripped. `fallbackType` (the menu id) and `fallbackFlow` (the
 * menu entry's flow) apply when the frontmatter omits `type:`/`flow:`.
 */
export function parseAgentPrompt(
  text: string,
  fallbackType: string,
  fallbackFlow?: string,
): AgentPrompt {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const frontmatter = match ? match[1] : '';
  const body = (match ? match[2] : text).trim();

  const fields: Record<string, unknown> = {};
  for (const rawLine of frontmatter.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw.startsWith('[') && raw.endsWith(']')) {
      fields[key] = raw
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      fields[key] = raw.replace(/^['"]|['"]$/g, '');
    }
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  // Effort is remote data — reject typos here so downstream carries ThinkingLevel.
  const effort = (v: unknown, key: string): ThinkingLevel | undefined => {
    if (v === undefined) return undefined;
    if (isThinkingLevel(v)) return v;
    logToFile(
      `[agent-prompt] ${fallbackType}: ignoring invalid ${key} "${String(v)}"`,
    );
    analytics.wizardCapture('agent prompt invalid effort', {
      task_type: fallbackType,
      key,
      value: String(v),
    });
    return undefined;
  };
  return {
    type: typeof fields.type === 'string' ? fields.type : fallbackType,
    label: typeof fields.label === 'string' ? fields.label : undefined,
    flow: typeof fields.flow === 'string' ? fields.flow : fallbackFlow,
    seed: fields.seed === 'true',
    sink: fields.sink === 'true',
    runnerSeeded: fields.runnerSeeded === 'true',
    modelPi: str(fields.model_pi),
    effortPi: effort(fields.effort_pi, 'effort_pi'),
    modelSdk: str(fields.model_sdk),
    effortSdk: effort(fields.effort_sdk, 'effort_sdk'),
    skills: toStringArray(fields.skills),
    allowedTools: toStringArray(fields.allowedTools),
    disallowedTools: toStringArray(fields.disallowedTools),
    dependsOn: toStringArray(fields.dependsOn),
    body,
  };
}

async function fetchText(url: string): Promise<string> {
  return fetchWithRetry(url, (res) => res.text());
}

/**
 * Fetch the agent menu and every agent prompt it lists, parse them, and build
 * the registry for one flow. Throws if the menu cannot be fetched — the
 * orchestrator cannot run without its prompts.
 */
export async function loadAgentRegistry(
  skillsBaseUrl: string,
  flow: string,
  opts?: Parameters<typeof buildRegistry>[2],
): Promise<AgentRegistry> {
  const menuRaw = await fetchText(`${skillsBaseUrl}/agent-menu.json`);
  const menu = JSON.parse(menuRaw) as AgentMenu;

  // Menus that carry a flow per entry let us skip other flows' prompts before
  // fetching them; entries without one are fetched and filtered by their
  // frontmatter in buildRegistry, as before.
  const entries = (menu.agents ?? []).filter(
    (entry) => !entry.flow || entry.flow === flow,
  );
  const prompts = await Promise.all(
    entries.map(async (entry) => {
      const text = await fetchText(entry.downloadUrl);
      return parseAgentPrompt(text, entry.id, entry.flow);
    }),
  );

  return buildRegistry(prompts, flow, opts);
}

/**
 * Render a task's own inputs into a section, so a fanned-out task (e.g. one
 * `capture` per event) sees the specific thing it owns. Empty when there are none.
 */
function renderInputs(task: QueuedTask): string {
  const entries = Object.entries(task.inputs ?? {});
  if (entries.length === 0) return '';
  const lines = entries.map(([k, v]) => `- ${k}: ${formatInputValue(v)}`);
  return `## Your task input\n\n${lines.join('\n')}`;
}

function formatInputValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * The ids of every task `task` transitively depends on — the full upstream
 * chain, not just direct dependencies — ordered roots-first, each once. A `seen`
 * set dedupes diamonds and guards against cycles.
 */
function ancestorIds(task: QueuedTask, store: QueueStore): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const t = store.get(id);
    if (!t) return;
    for (const dep of t.dependsOn) visit(dep); // ancestors before dependents
    ordered.push(id);
  };
  for (const dep of task.dependsOn) visit(dep);
  return ordered;
}

/**
 * Render the handoffs of every step `task` transitively depends on into a context
 * section, so a fresh agent sees the whole upstream chain — not just its direct
 * dependencies. Reliability over token economy: a step must never have to
 * re-discover what any ancestor already established just because an intermediate
 * handoff happened to omit it. Empty when there are no completed ancestors.
 */
function renderHandoffContext(task: QueuedTask, store: QueueStore): string {
  const lines: string[] = [];
  for (const id of ancestorIds(task, store)) {
    const dep = store.get(id);
    const handoff = store.readHandoff(id);
    if (!dep || !handoff) continue;
    lines.push(`### ${dep.type}`);
    lines.push(`- did: ${handoff.did}`);
    lines.push(`- for you: ${handoff.forNextAgent}`);
    if (handoff.filesTouched?.length) {
      lines.push(`- files: ${handoff.filesTouched.join(', ')}`);
    }
    if (handoff.evidence) {
      lines.push(`- evidence: ${handoff.evidence}`);
    }
    if (handoff.assumptions) {
      lines.push(`- assumed: ${handoff.assumptions}`);
    }
    if (handoff.reportSection) {
      lines.push(`- report section:\n${handoff.reportSection}`);
    }
    lines.push('');
  }
  if (lines.length === 0) return '';
  return `## Context from previous steps\n\n${lines.join('\n')}`.trim();
}

/**
 * Resolve a queued task to its run config: the prompt body (with upstream
 * handoffs appended), the model, and the tool lists with orchestrator tool names
 * MCP-qualified. The model precedence is enqueue override, then prompt, then
 * default. Throws if no prompt is registered for the task's type.
 */
export function resolveTask(
  registry: AgentRegistry,
  task: QueuedTask,
  store: QueueStore,
): ResolvedTask {
  const prompt = registry.get(task.type);
  if (!prompt) {
    throw new Error(`No agent prompt registered for task type "${task.type}"`);
  }

  const body = [
    renderInputs(task),
    prompt.body,
    renderHandoffContext(task, store),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    ...agentRunTools(prompt),
    prompt: body,
    skills: prompt.skills,
  };
}

/** The model + effort a task runs on for a harness: enqueue override, then the
 * prompt's per-profile frontmatter; the caller's switchboard pick is the fallback. */
export function taskModelSpec(
  registry: AgentRegistry,
  task: QueuedTask,
  harness: string,
): { model?: string; effort?: ThinkingLevel } {
  const picked = promptModelFor(
    registry.get(task.type) ?? EMPTY_PROMPT,
    harness,
  );
  return {
    model: task.model ?? picked.model,
    effort: picked.effort,
  };
}

const EMPTY_PROMPT = {} as AgentPrompt;
