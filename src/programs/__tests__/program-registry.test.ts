import {
  PROGRAM_REGISTRY,
  getCommandPath,
  getSubcommandPrograms,
} from '../program-registry';
import { config as agentSkill } from '@programs/agent-skill';
import type { RunnerContext } from '../runner-context';
import type { WizardSession } from '../session/wizard-session';

/** The host effects a run may use; the runs here use none. */
const runner: RunnerContext = {
  getFrameworkContext: () => undefined,
  setFrameworkContext: () => undefined,
  log: { info: () => undefined, warn: () => undefined },
  spinner: () => ({
    start: () => undefined,
    stop: () => undefined,
    message: () => undefined,
  }),
};

describe('PROGRAM_REGISTRY', () => {
  it('every entry has a unique id and a description', () => {
    const ids = PROGRAM_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const config of PROGRAM_REGISTRY) {
      expect(config.description).toBeTruthy();
    }
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
});

describe('parentCommand nesting', () => {
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
        ? await agentSkill.run(session, runner)
        : agentSkill.run!;

    expect(run.skillId).toBe('audit-events');
    expect(run.integrationLabel).toBe('audit-events');
    expect(run.reportFile).toContain('audit-events');
  });
});
