import { AdditionalFeature } from '@shared/config/constants';
import type { PromptContext } from '@agent/types';
import type { ProgramRunHost } from '@programs/types';
import { testProgramRunHost } from '../../../../test/program-host';
import { warehouseSourceConfig } from '@programs/warehouse-source/index';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@programs/warehouse-source/detect';
import { resolveProgramRunDefinition } from '../resolve-run-definition';
import type { WizardSession } from '@tui/state/session';

const promptContext = {
  projectId: 42,
  projectApiKey: 'phc_fixture',
  host: {
    apiHost: 'https://us.i.posthog.com',
    appHost: 'https://us.posthog.com',
  },
} as unknown as PromptContext;

describe('data-only program run definitions', () => {
  it('resolves a generic agent skill only from an explicit skill ID', () => {
    expect(resolveProgramRunDefinition('agent-skill', {})).toBeUndefined();
    expect(
      resolveProgramRunDefinition('agent-skill', { skillId: 'autocapture' }),
    ).toMatchObject({
      skillId: 'autocapture',
      reportFile: 'posthog-autocapture-report.md',
    });
  });
  it('resolves events-audit from explicit TypeScript and feature inputs', () => {
    const run = resolveProgramRunDefinition('events-audit', {
      typescript: true,
      additionalFeatureQueue: [AdditionalFeature.LLM],
    });

    expect(run?.skillId).toBe('events-audit');
    expect(run?.additionalFeatureQueue).toEqual([AdditionalFeature.LLM]);
    expect(run?.customPrompt?.(promptContext)).toContain('TypeScript: Yes');
  });

  it('builds the warehouse prompt from detected source data', () => {
    const run = resolveProgramRunDefinition('warehouse-source', {
      warehouseSources: [
        {
          kind: 'Postgres',
          label: 'PostgreSQL',
          mode: 'in-cli',
          matchedSignal: '.env: DATABASE_URL',
        },
      ],
    });

    expect(run?.customPrompt?.(promptContext)).toContain(
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
    session.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY] = [
      {
        kind: 'Postgres',
        label: 'PostgreSQL',
        mode: 'in-cli',
        matchedSignal: '.env: DATABASE_URL',
      },
    ];
    expect(run.customPrompt?.(promptContext)).toContain('.env: DATABASE_URL');
  });

  it('uses an explicit source-maps selection and handles a missing one', () => {
    const selected = resolveProgramRunDefinition(
      'error-tracking-upload-source-maps',
      {
        sourceMapsSelection: {
          variant: 'nextjs',
          displayName: 'Next.js',
          projectPath: 'apps/web',
        },
      },
    );
    const missing = resolveProgramRunDefinition(
      'error-tracking-upload-source-maps',
      {},
    );

    expect(selected?.skillId).toBeUndefined();
    expect(selected?.customPrompt?.(promptContext)).toContain('apps/web');
    expect(selected?.customPrompt?.(promptContext)).toContain('Next.js');
    expect(missing?.customPrompt?.(promptContext)).toContain(
      'Detection did not pick a source maps skill variant',
    );
  });

  it('resolves audit and error-tracking without session or UI input', () => {
    const audit = resolveProgramRunDefinition('audit', {});
    const errors = resolveProgramRunDefinition('error-tracking', {});

    expect(audit?.reportFile).toBe('posthog-audit-report.md');
    expect(errors?.askTimeoutMs).toBe(30 * 60 * 1000);
    expect(resolveProgramRunDefinition('unknown', {})).toBeUndefined();
  });
});
