import {
  PROGRAM_REGISTRY,
  agentSkillConfig,
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

    expect(commands).toContain('integrate');
    expect(commands).toContain('revenue-analytics');
    for (const config of subcommands) {
      expect(config.command).toBeTruthy();
    }
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
