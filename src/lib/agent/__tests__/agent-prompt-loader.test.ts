import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  agentRunTools,
  assembleTaskPrompt,
  buildRegistry,
  parseAgentPrompt,
  resolveTask,
  taskModel,
  type AgentPrompt,
  type AgentRegistry,
  type OrchestratorPromptContext,
} from '../agent-prompt-loader';
import { QueueStore } from '@lib/agent/runner/mode/orchestrator/queue';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loader-test-'));
}

function registryOf(prompts: AgentPrompt[]): AgentRegistry {
  return buildRegistry(
    prompts.map((p) => ({ ...p, flow: 'test-flow' })),
    'test-flow',
  );
}

describe('parseAgentPrompt', () => {
  const sample = `---
type: instrument-events
model: claude-sonnet-4-6     # cheapest model that succeeds
skills: [instrument-events]
allowedTools: [Read, Edit, Grep, Glob, Bash]
disallowedTools: [enqueue_task]
dependsOn: [init]
---

## Goal
Add at least one capture call.
`;

  it('parses frontmatter scalars and inline arrays', () => {
    const p = parseAgentPrompt(sample, 'fallback');
    expect(p.type).toBe('instrument-events');
    expect(p.model).toBe('claude-sonnet-4-6');
    expect(p.skills).toEqual(['instrument-events']);
    expect(p.allowedTools).toEqual(['Read', 'Edit', 'Grep', 'Glob', 'Bash']);
    expect(p.disallowedTools).toEqual(['enqueue_task']);
    expect(p.dependsOn).toEqual(['init']);
  });

  it('strips inline comments and keeps the body', () => {
    const p = parseAgentPrompt(sample, 'fallback');
    expect(p.model).not.toContain('#');
    expect(p.body).toContain('## Goal');
    expect(p.body).not.toContain('---');
  });

  it('falls back to the menu id when type is omitted', () => {
    const p = parseAgentPrompt('---\nmodel: x\n---\nbody', 'install');
    expect(p.type).toBe('install');
  });

  it('parses the flow from frontmatter', () => {
    const p = parseAgentPrompt('---\nflow: audit\n---\nx', 'fix-events');
    expect(p.flow).toBe('audit');
  });

  it('marks the seed from frontmatter; everything else is a task', () => {
    expect(parseAgentPrompt('---\nseed: true\n---\nplan', 'planner').seed).toBe(
      true,
    );
    expect(parseAgentPrompt('---\nmodel: x\n---\nbody', 'install').seed).toBe(
      false,
    );
  });

  it('defaults missing array fields to empty and model to undefined', () => {
    const p = parseAgentPrompt('no frontmatter at all', 'stub');
    expect(p.model).toBeUndefined();
    expect(p.skills).toEqual([]);
    expect(p.dependsOn).toEqual([]);
    expect(p.body).toBe('no frontmatter at all');
  });
});

describe('agentRunTools', () => {
  it('MCP-qualifies orchestrator tools and passes native tools through', () => {
    const p = parseAgentPrompt(
      '---\nallowedTools: [Read, read_handoffs]\ndisallowedTools: [enqueue_task, complete_task, Bash]\n---\nx',
      't',
    );
    const { allowedTools, disallowedTools } = agentRunTools(p);
    expect(allowedTools).toEqual([
      'Read',
      'mcp__posthog-wizard__read_handoffs',
    ]);
    expect(disallowedTools).toEqual([
      'mcp__posthog-wizard__enqueue_task',
      'mcp__posthog-wizard__complete_task',
      'Bash',
    ]);
  });
});

describe('buildRegistry', () => {
  const prompt = (over: Partial<AgentPrompt>): AgentPrompt => ({
    type: 'x',
    seed: false,
    skills: [],
    allowedTools: [],
    disallowedTools: [],
    dependsOn: [],
    body: 'b',
    ...over,
  });

  it('scopes to one flow and keeps the seed out of the task types', () => {
    const registry = buildRegistry(
      [
        prompt({ type: 'plan-audit', flow: 'audit', seed: true }),
        prompt({ type: 'fix-events', flow: 'audit' }),
        prompt({ type: 'install', flow: 'posthog-integration' }),
        prompt({ type: 'example' }),
      ],
      'audit',
    );
    expect(registry.types).toEqual(['fix-events']);
    expect(registry.seed?.type).toBe('plan-audit');
    expect(registry.get('install')).toBeUndefined();
    // A flowless prompt (e.g. the documentation example) joins no registry.
    expect(registry.get('example')).toBeUndefined();
  });

  it('drops harness-excluded types; unrestricted runs keep them', () => {
    const prompts = [
      prompt({ type: 'plan', flow: 'f', seed: true }),
      prompt({ type: 'build', flow: 'f' }),
      prompt({ type: 'dashboard', flow: 'f' }),
    ];
    expect(
      buildRegistry(prompts, 'f', { exclude: ['dashboard'] }).types,
    ).toEqual(['build']);
    expect(buildRegistry(prompts, 'f').types).toEqual(['build', 'dashboard']);
  });
});

describe('resolveTask', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = tmpDir();
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const prompt: AgentPrompt = {
    type: 'capture',
    seed: false,
    model: 'claude-haiku-4-5-20251001',
    skills: ['instrument-events'],
    allowedTools: ['Read', 'Edit'],
    disallowedTools: ['enqueue_task'],
    dependsOn: ['plan-capture'],
    body: '## Goal\nInstrument the planned events.',
  };

  it('throws when no prompt is registered for the type', () => {
    const registry = registryOf([]);
    const task = { type: 'capture', dependsOn: [] } as never;
    expect(() => resolveTask(registry, task, store)).toThrow(/capture/);
  });

  it('resolves model, tools, and skills from the prompt', () => {
    const registry = registryOf([prompt]);
    const task = store.enqueue({ type: 'capture' });
    const resolved = resolveTask(registry, task, store);
    expect(resolved.model).toBe('claude-haiku-4-5-20251001');
    expect(resolved.skills).toEqual(['instrument-events']);
    expect(resolved.disallowedTools).toEqual([
      'mcp__posthog-wizard__enqueue_task',
    ]);
  });

  it('prefers the enqueue model override over the prompt model', () => {
    const registry = registryOf([prompt]);
    const task = store.enqueue({ type: 'capture', model: 'override-x' });
    expect(resolveTask(registry, task, store).model).toBe('override-x');
  });

  it("appends upstream dependencies' handoffs as context", () => {
    const registry = registryOf([prompt]);
    const dep = store.enqueue({ type: 'plan-capture' });
    store.complete(dep.id, {
      goals: 'decide events',
      did: 'picked signup and purchase',
      forNextAgent: 'instrument those two',
    });
    const task = store.enqueue({
      type: 'capture',
      dependsOn: [dep.id],
    });
    const resolved = resolveTask(registry, task, store);
    expect(resolved.prompt).toContain('Context from previous steps');
    expect(resolved.prompt).toContain('picked signup and purchase');
    expect(resolved.prompt).toContain('instrument those two');
  });

  it('omits the context section when there are no handoffs', () => {
    const registry = registryOf([prompt]);
    const task = store.enqueue({ type: 'capture' });
    expect(resolveTask(registry, task, store).prompt).not.toContain(
      'Context from previous steps',
    );
  });

  it('includes transitive ancestors, not just direct dependencies', () => {
    const registry = registryOf([prompt]);
    // install -> capture -> (this task). The task depends only on capture, but
    // install's context must still reach it so nothing is silently lost.
    const install = store.enqueue({ type: 'install' });
    store.complete(install.id, {
      goals: 'declare the SDK',
      did: 'added posthog to the manifest',
      forNextAgent: 'SDK is declared, not yet installed',
    });
    const capture = store.enqueue({ type: 'capture', dependsOn: [install.id] });
    store.complete(capture.id, {
      goals: 'instrument events',
      did: 'added capture calls',
      forNextAgent: 'events are in',
    });
    const task = store.enqueue({ type: 'capture', dependsOn: [capture.id] });
    const { prompt: out } = resolveTask(registry, task, store);
    expect(out).toContain('added posthog to the manifest'); // transitive
    expect(out).toContain('added capture calls'); // direct
  });

  it('lists each ancestor once for diamond dependencies', () => {
    const registry = registryOf([prompt]);
    const install = store.enqueue({ type: 'install' });
    store.complete(install.id, {
      goals: 'g',
      did: 'manifest entry added',
      forNextAgent: 'n',
    });
    const a = store.enqueue({ type: 'identify', dependsOn: [install.id] });
    store.complete(a.id, { goals: 'g', did: 'a-did', forNextAgent: 'n' });
    const b = store.enqueue({ type: 'identify', dependsOn: [install.id] });
    store.complete(b.id, { goals: 'g', did: 'b-did', forNextAgent: 'n' });
    // Resolved task must be a registered type (capture); its ancestors need not be.
    const task = store.enqueue({ type: 'capture', dependsOn: [a.id, b.id] });
    const { prompt: out } = resolveTask(registry, task, store);
    expect(out.match(/manifest entry added/g)).toHaveLength(1);
  });
});

describe('taskModel', () => {
  const prompt = parseAgentPrompt(
    '---\nmodel: prompt-model\n---\nx',
    'capture',
  );

  it('prefers the enqueue override, then the prompt, then the default', () => {
    const registry = registryOf([prompt]);
    const task = { type: 'capture' };
    expect(taskModel(registry, { ...task, model: 'override' } as never)).toBe(
      'override',
    );
    expect(taskModel(registry, task as never)).toBe('prompt-model');
    expect(taskModel(registryOf([]), task as never)).toBe('claude-sonnet-4-6');
  });
});

describe('assembleTaskPrompt', () => {
  const ctx: OrchestratorPromptContext = {
    projectId: 1,
    projectApiKey: 'phc_x',
    host: 'https://us.posthog.com',
  };

  it('points the agent at its installed task instructions', () => {
    const assembled = assembleTaskPrompt(ctx, 'do the task', [
      '.posthog-wizard/skills/capture/SKILL.md',
    ]);
    expect(assembled).toContain('.posthog-wizard/skills/capture/SKILL.md');
    expect(assembled).toContain('do the task');
  });

  it('omits the instructions section when no skills are installed', () => {
    expect(assembleTaskPrompt(ctx, 'do the task')).not.toContain(
      'task instructions',
    );
  });
});
