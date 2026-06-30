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
import type { QueueStore, QueuedTask } from './runner/mode/orchestrator/queue';
import type { ResolvedTask } from './runner/mode/orchestrator/executor';
import { DEFAULT_AGENT_MODEL } from '@lib/constants';

/**
 * The basics the client injects around every agent-prompt body. The `/agents/`
 * files carry intent only (goal, success criteria); the wizard owns the I/O
 * contract — who the agent is, how it reports, how it surfaces progress — so the
 * authored prompts never restate it.
 */
export interface OrchestratorPromptContext {
  projectId: number;
  projectApiKey: string;
  host: string;
  /** Path to the framework's reference implementation (EXAMPLE.md), if available. */
  examplePath?: string;
  /** Path to the framework's rules (COMMANDMENTS.md), if available. */
  commandmentsPath?: string;
}

function projectContext(ctx: OrchestratorPromptContext): string {
  return `You have access to the PostHog MCP server and the wizard tools.

Project context:
- PostHog Project ID: ${ctx.projectId}
- PostHog public token: ${ctx.projectApiKey}
- PostHog Host: ${ctx.host}`;
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

const TASK_BASICS = `You are one isolated task in a larger PostHog workflow, run as a fresh agent with no memory of the other tasks beyond the context you are given. Do only your task, then report exactly once by calling complete_task with a structured handoff: what your goal was, what you did, and what the next agent should know. When you are given context from previous steps, trust it — those agents already did their work, so do not re-verify or re-read what their handoffs tell you. Build on it and move fast. Read a file before you edit it, so your own changes do not duplicate what is already there. Work only inside this project's own directory: never read, list, or search (find, ls, grep, glob) outside it — not the OS, not other projects, not global package caches. If your task seems to need something outside this directory, it does not — skip that part and say so in your handoff rather than hunting across the filesystem. If your task does not apply to this project — there is genuinely nothing for it to do — report it with status \`skipped\` and say why, rather than marking it done.`;

const SEED_BASICS = `You are the orchestrator. Plan the work and seed the queue with enqueue_task — each call returns an id you can pass as a dependency to a later task. Give each task a short label for the UI — the action in a few words, not file names, class names, or other specifics. You are not a task yourself: do not call complete_task and do not edit the project.`;

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
): string {
  return [projectContext(ctx), SEED_BASICS, body].join('\n\n');
}

/** Used when neither the enqueue call nor the prompt frontmatter names a model. */
const DEFAULT_TASK_MODEL = DEFAULT_AGENT_MODEL;

/** Orchestrator tools are MCP tools under the `posthog-wizard` server. Frontmatter
 *  names them short (e.g. `enqueue_task`); the SDK gates on the full name. */
const ORCHESTRATOR_TOOL_PREFIX = 'mcp__posthog-wizard__';
const ORCHESTRATOR_TOOLS = new Set([
  'enqueue_task',
  'complete_task',
  'read_handoffs',
]);

/** A parsed agent prompt. The frontmatter fields plus the markdown body. */
export interface AgentPrompt {
  type: string;
  /** Human-readable title for the TUI; falls back to `type` when absent. */
  label?: string;
  /** The flow this agent belongs to (the program id, e.g. \`posthog-integration\`). */
  flow?: string;
  /** Marks the flow's planner: it seeds the queue and is not an enqueueable task. */
  seed: boolean;
  model?: string;
  skills: string[];
  allowedTools: string[];
  disallowedTools: string[];
  dependsOn: string[];
  body: string;
}

export interface AgentRegistry {
  /** The flow's enqueueable task types — every prompt except the seed. */
  readonly types: string[];
  /** The flow's planner, the one prompt marked `seed: true` in its frontmatter. */
  readonly seed?: AgentPrompt;
  get(type: string): AgentPrompt | undefined;
}

/** The registry for one flow's prompts. Pure; the loader feeds it the fetched set. */
export function buildRegistry(
  prompts: readonly AgentPrompt[],
  flow: string,
  opts?: { exclude?: readonly string[] },
): AgentRegistry {
  // The harness can exclude task types (CI excludes dashboards). An excluded
  // type does not exist for the run: the seed cannot enqueue it and no agent
  // is ever spun up for it.
  const excluded = new Set(opts?.exclude ?? []);
  const inFlow = prompts.filter(
    (p) => p.flow === flow && !excluded.has(p.type),
  );
  const byType = new Map(inFlow.map((p) => [p.type, p]));
  return {
    types: inFlow.filter((p) => !p.seed).map((p) => p.type),
    seed: inFlow.find((p) => p.seed),
    get: (type) => byType.get(type),
  };
}

interface AgentMenu {
  agents: { id: string; downloadUrl: string }[];
}

/** A native tool passes through; an orchestrator tool gets its MCP-qualified name. */
function expandToolName(name: string): string {
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
 * value are stripped. `fallbackType` is the menu id, used when the body omits
 * `type:`.
 */
export function parseAgentPrompt(
  text: string,
  fallbackType: string,
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

  const model = typeof fields.model === 'string' ? fields.model : undefined;
  return {
    type: typeof fields.type === 'string' ? fields.type : fallbackType,
    label: typeof fields.label === 'string' ? fields.label : undefined,
    flow: typeof fields.flow === 'string' ? fields.flow : undefined,
    seed: fields.seed === 'true',
    model,
    skills: toStringArray(fields.skills),
    allowedTools: toStringArray(fields.allowedTools),
    disallowedTools: toStringArray(fields.disallowedTools),
    dependsOn: toStringArray(fields.dependsOn),
    body,
  };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Fetch the agent menu and every agent prompt it lists, parse them, and build
 * the registry for one flow. Throws if the menu cannot be fetched — the
 * orchestrator cannot run without its prompts.
 */
export async function loadAgentRegistry(
  skillsBaseUrl: string,
  flow: string,
  opts?: { exclude?: readonly string[] },
): Promise<AgentRegistry> {
  const menuRaw = await fetchText(`${skillsBaseUrl}/agent-menu.json`);
  const menu = JSON.parse(menuRaw) as AgentMenu;

  const prompts = await Promise.all(
    (menu.agents ?? []).map(async (entry) => {
      const text = await fetchText(entry.downloadUrl);
      return parseAgentPrompt(text, entry.id);
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
    model: taskModel(registry, task),
    ...agentRunTools(prompt),
    prompt: body,
    skills: prompt.skills,
  };
}

/** The model a task runs on: enqueue override, then prompt frontmatter, then default. */
export function taskModel(registry: AgentRegistry, task: QueuedTask): string {
  return task.model ?? registry.get(task.type)?.model ?? DEFAULT_TASK_MODEL;
}
