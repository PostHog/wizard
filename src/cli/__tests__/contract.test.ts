import { expectTypeOf } from 'vitest';
import type { RunAgent } from '@agent/types';
import { Program } from '@store/programs';
import type { TuiHandle } from '@tui/types';
import { commandKeys } from '../commands/command.js';
import { fakeRunAgent, fakeStartTUI } from '../testing/fake-surfaces.js';
import type { Command } from '../types.js';
import { basicIntegrationCommand } from '../commands/basic-integration/index.js';
import { mcpCommand } from '../commands/mcp/index.js';
import { mcpAnalyticsCommand } from '../commands/mcp-analytics.js';
import { replayVisionCommand } from '../commands/replay-vision.js';
import { aiObservabilityCommand } from '../commands/ai-observability.js';
import { metricsCommand } from '../commands/metrics.js';
import { auditCommand } from '../commands/audit.js';
import { doctorCommand } from '../commands/doctor.js';
import { migrateCommand } from '../commands/migrate.js';
import { revenueCommand } from '../commands/revenue.js';
import { warehouseCommand } from '../commands/warehouse.js';
import { selfDrivingCommand } from '../commands/self-driving.js';
import { slackCommand } from '../commands/slack.js';
import { uploadSourcemapsCommand } from '../commands/upload-sourcemaps.js';
import { errorTrackingCommand } from '../commands/error-tracking.js';
import { skillCommand } from '../commands/skill.js';
import { cliCommand } from '../commands/cli/index.js';

/** Every command main.ts registers. */
const COMMANDS: readonly Command[] = [
  basicIntegrationCommand,
  mcpCommand,
  mcpAnalyticsCommand,
  replayVisionCommand,
  aiObservabilityCommand,
  metricsCommand,
  cliCommand,
  auditCommand,
  doctorCommand,
  migrateCommand,
  revenueCommand,
  warehouseCommand,
  selfDrivingCommand,
  slackCommand,
  uploadSourcemapsCommand,
  errorTrackingCommand,
  skillCommand,
];

describe('cli contract', () => {
  it('registers commands with unique names and aliases', () => {
    const keys = COMMANDS.flatMap((c) => commandKeys(c.name));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every command has a description and a handler or children', () => {
    for (const c of COMMANDS) {
      expect(c.description.length, String(c.name)).toBeGreaterThan(0);
      expect(
        typeof c.handler === 'function' || (c.children?.length ?? 0) > 0,
        String(c.name),
      ).toBe(true);
    }
  });

  it('the fakes match the surface entry types', () => {
    const { runAgent } = fakeRunAgent();
    expectTypeOf(runAgent).toEqualTypeOf<RunAgent>();
    const tui = fakeStartTUI(Program.PostHogIntegration);
    expectTypeOf(tui).toMatchTypeOf<TuiHandle>();
    expect(tui.store.currentScreen).toBe('intro');
  });
});
