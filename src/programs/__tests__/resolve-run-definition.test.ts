import { AdditionalFeature } from '@shared/constants';
import type { PromptContext } from '@agent/types';
import type { WizardSession } from '@lib/wizard-session';
import type { ProgramRunHost } from '@programs/types';
import { testProgramRunHost } from '../../../test/program-host';
import { warehouseSourceConfig } from '@programs/warehouse-source/index';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@programs/warehouse-source/detect';
import {
  resolveEventsAuditRunDefinition,
  resolveWarehouseSourceRunDefinition,
} from '../resolve-run-definition';

const promptContext = {
  projectId: 42,
  projectApiKey: 'phc_fixture',
  host: {
    apiHost: 'https://us.i.posthog.com',
    appHost: 'https://us.posthog.com',
  },
} as unknown as PromptContext;

const postgres = {
  kind: 'Postgres',
  label: 'PostgreSQL',
  mode: 'in-cli',
  matchedSignal: '.env: DATABASE_URL',
} as const;

describe('data-only program run definitions', () => {
  it('resolves events-audit from explicit TypeScript and feature inputs', () => {
    const run = resolveEventsAuditRunDefinition({
      typescript: true,
      additionalFeatureQueue: [AdditionalFeature.LLM],
    });

    expect(run.skillId).toBe('events-audit');
    expect(run.additionalFeatureQueue).toEqual([AdditionalFeature.LLM]);
    expect(run.customPrompt?.(promptContext)).toContain('TypeScript: Yes');
  });

  it('builds the warehouse prompt from detected source data', () => {
    const run = resolveWarehouseSourceRunDefinition([postgres]);

    expect(run.customPrompt?.(promptContext)).toContain(
      'PostgreSQL (kind: Postgres, mode: in-cli) — .env: DATABASE_URL',
    );
  });

  it('keeps the legacy warehouse prompt live until detection finishes', async () => {
    const session = { frameworkContext: {} } as WizardSession;
    const resolve = warehouseSourceConfig.run as (
      session: WizardSession,
      host: ProgramRunHost,
    ) => Promise<{ customPrompt?: (ctx: PromptContext) => string }>;
    const run = await resolve(session, testProgramRunHost(session));
    session.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY] = [postgres];
    expect(run.customPrompt?.(promptContext)).toContain('.env: DATABASE_URL');
  });
});
