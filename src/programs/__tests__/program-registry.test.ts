import {
  PROGRAM_REGISTRY,
  getCommandPath,
  getProgramConfig,
  getSubcommandPrograms,
} from '../program-registry';
import { DEFAULT_BINDING } from '@agent';
import {
  DEFAULT_AGENT_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  Harness,
  Sequence,
} from '@shared/constants';
import { config as agentSkill } from '@programs/agent-skill';
import { testRunnerContext } from '../shared/__tests__/runner-context.no-jest';
import type { WizardSession } from '../session/wizard-session';

describe('PROGRAM_REGISTRY', () => {
  it('every entry has a unique id and a description', () => {
    const ids = PROGRAM_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const config of PROGRAM_REGISTRY) {
      expect(config.description).toBeTruthy();
    }
  });
});

describe('getProgramConfig', () => {
  it('finds known configs by id', () => {
    expect(getProgramConfig('posthog-integration').id).toBe(
      'posthog-integration',
    );
    expect(getProgramConfig('revenue-analytics-setup').command).toBe(
      'revenue-analytics',
    );
  });
});

// A binding sets a program's sequence, harness, model and effort, so an edit
// changes the cost and output of every run of it.
describe('program bindings', () => {
  const linearOnSol = {
    sequence: Sequence.linear,
    harness: Harness.pi,
    model: GPT5_6_SOL_MODEL,
    thinkingLevel: 'medium',
  };
  const orchestratorOnPi = {
    sequence: Sequence.orchestrator,
    harness: Harness.pi,
    model: DEFAULT_AGENT_MODEL,
  };

  it('routes every program, and the default for one with no binding', () => {
    const routes = Object.fromEntries(
      PROGRAM_REGISTRY.map((c) => [c.id, c.binding ?? DEFAULT_BINDING]),
    );
    expect(routes).toEqual({
      'posthog-integration': linearOnSol,
      'mcp-analytics': linearOnSol,
      'replay-vision': {
        sequence: Sequence.orchestrator,
        harness: Harness.anthropic,
        model: DEFAULT_AGENT_MODEL,
      },
      'ai-observability': {
        sequence: Sequence.linear,
        harness: Harness.pi,
        model: GPT5_6_TERRA_MODEL,
        thinkingLevel: 'high',
      },
      metrics: orchestratorOnPi,
      audit: linearOnSol,
      'events-audit': linearOnSol,
      'web-analytics-doctor': linearOnSol,
      migration: linearOnSol,
      'revenue-analytics-setup': linearOnSol,
      'warehouse-source': linearOnSol,
      'self-driving': linearOnSol,
      'error-tracking-upload-source-maps': linearOnSol,
      'error-tracking': orchestratorOnPi,
      'agent-skill': linearOnSol,
    });
  });
});

describe('getSubcommandPrograms', () => {
  it('returns only programs that have a CLI command', () => {
    const subcommands = getSubcommandPrograms();
    const commands = subcommands.map((c) => c.command);

    expect(commands).toContain('revenue-analytics');
    for (const config of subcommands) {
      expect(config.command).toBeTruthy();
    }
  });
});

// A nested program is only reachable through its parent's word.
describe('getCommandPath', () => {
  const subcommand = (id: string) =>
    getSubcommandPrograms().find((config) => config.id === id)!;

  it('reaches a nested program through its parent', () => {
    expect(getCommandPath(subcommand('web-analytics-doctor'))).toBe(
      'audit web-analytics',
    );
  });

  it('leaves a top-level program alone', () => {
    expect(getCommandPath(subcommand('revenue-analytics-setup'))).toBe(
      'revenue-analytics',
    );
  });

  it('keeps `metrics` a flat command', () => {
    expect(getCommandPath(subcommand('metrics'))).toBe('metrics');
  });
});

describe('parentCommand nesting', () => {
  it('nests web-analytics-doctor under the audit command', () => {
    const webAnalytics = getProgramConfig('web-analytics-doctor');
    expect(webAnalytics.command).toBe('web-analytics');
    expect(webAnalytics.parentCommand).toBe('audit');
  });

  it('keeps audit as a top-level command', () => {
    const audit = getProgramConfig('audit');
    expect(audit.command).toBe('audit');
    expect(audit.parentCommand).toBeUndefined();
  });

  it('every parentCommand refers to a registered top-level command', () => {
    const topLevelCommands = new Set(
      getSubcommandPrograms()
        .filter((c) => c.parentCommand == null)
        .map((c) => c.command),
    );
    const parentCommands = getSubcommandPrograms()
      .map((c) => c.parentCommand)
      .filter((p): p is string => p != null);
    for (const parent of parentCommands) {
      expect(topLevelCommands).toContain(parent);
    }
  });
});

describe('agent-skill run recipe', () => {
  // Regression guard: the agent-skill config backs `wizard skill <name>` and the
  // narrow `audit` leaves. runProgram fails with "has no run configuration"
  // when a config has no `run`, so a missing recipe means those commands fail
  // instead of running the skill.
  it('derives run metadata from the dispatched skillId', async () => {
    expect(typeof agentSkill.run).toBe('function');
    const session = { skillId: 'audit-events' } as unknown as WizardSession;
    const run =
      typeof agentSkill.run === 'function'
        ? await agentSkill.run(session, testRunnerContext())
        : agentSkill.run!;

    expect(run.skillId).toBe('audit-events');
    expect(run.integrationLabel).toBe('audit-events');
    expect(run.reportFile).toContain('audit-events');
  });
});
