import {
  PROGRAM_REGISTRY,
  agentSkillConfig,
  getCommandPath,
  getLaunchablePrograms,
  getProgramConfig,
  getSubcommandPrograms,
} from '@lib/programs/program-registry';
import type { WizardSession } from '@lib/wizard-session';

describe('PROGRAM_REGISTRY', () => {
  it('every entry has unique id, description, and non-empty steps', () => {
    const ids = PROGRAM_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const config of PROGRAM_REGISTRY) {
      expect(config.description).toBeTruthy();
      expect(config.steps.length).toBeGreaterThan(0);
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

// What a user types to reach the program. A nested program's own `command` is
// only half of that, so anything telling a user how to run one has to join it
// to the parent.
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

// The programs the intro can hand off to in-session. A family parent isn't one
// of them — typing `wizard audit` opens a picker rather than running anything,
// so there's nothing to hand off to. Its leaves are still fair game.
describe('getLaunchablePrograms', () => {
  const ids = () => getLaunchablePrograms().map((config) => config.id);

  it('skips a family parent', () => {
    expect(ids()).not.toContain('audit');
  });

  it('keeps the leaves under that family', () => {
    expect(ids()).toContain('web-analytics-doctor');
  });

  it('keeps the flat programs', () => {
    expect(ids()).toContain('revenue-analytics-setup');
    expect(ids()).toContain('metrics');
  });

  // A row wider than the terminal stops the whole block from centering.
  it('keeps every row inside an 80-column terminal', () => {
    const COMMAND_COLUMN = 21;
    const MARKER_PREFIX = 2;
    const BUDGET = 80 - COMMAND_COLUMN - MARKER_PREFIX;

    const tooLong = getLaunchablePrograms()
      .filter((config) => config.description.length > BUDGET)
      .map((config) => `${config.id} (${config.description.length})`);

    expect(tooLong).toEqual([]);
  });

  // The intro copy promises these three by name, directly above the list.
  it('leads with the three the intro copy names', () => {
    expect(ids().slice(0, 3)).toEqual([
      'web-analytics-doctor',
      'error-tracking-upload-source-maps',
      'self-driving',
    ]);
  });

  // Derived from who claims whom as a parent, so the next family drops out on
  // its own instead of waiting for someone to remember this list.
  it('drops nothing but parents', () => {
    const parents = new Set(
      getSubcommandPrograms().map((config) => config.parentCommand),
    );
    const dropped = getSubcommandPrograms()
      .filter((config) => !ids().includes(config.id))
      .map((config) => config.command);

    expect(dropped).not.toEqual([]);
    expect(dropped.every((command) => parents.has(command))).toBe(true);
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

describe('agentSkillConfig run recipe', () => {
  // Regression guard: `agentSkillConfig` backs `wizard skill <name>` and the
  // narrow `audit` leaves. The runner skips the agent entirely when a config
  // has no `run` (run-wizard.ts `skipAgent`), so a missing recipe means those
  // commands silently no-op instead of running the skill.
  it('defines a run recipe so the agent is not skipped', () => {
    expect(agentSkillConfig.run).toBeDefined();
  });

  it('derives run metadata from the dispatched skillId', async () => {
    expect(typeof agentSkillConfig.run).toBe('function');
    const session = { skillId: 'audit-events' } as unknown as WizardSession;
    const run =
      typeof agentSkillConfig.run === 'function'
        ? await agentSkillConfig.run(session)
        : agentSkillConfig.run!;

    expect(run.skillId).toBe('audit-events');
    expect(run.integrationLabel).toBe('audit-events');
    expect(run.reportFile).toContain('audit-events');
    // Fields the runner relies on to render the run + outro.
    expect(run.spinnerMessage).toBeTruthy();
    expect(run.successMessage).toBeTruthy();
    expect(run.docsUrl).toBeTruthy();
    expect(run.estimatedDurationMinutes).toBeGreaterThan(0);
  });
});
