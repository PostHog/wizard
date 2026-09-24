import type { PromptContext } from '@agent/types';
import type { WizardSession } from '@lib/wizard-session';
import type { ProgramRun } from '@programs/program-run';
import type { ProgramRunHost } from '@programs/host-capabilities';
import { errorTrackingUploadSourceMapsConfig } from '@programs/error-tracking-upload-source-maps/index';
import { SOURCE_MAPS_CONTEXT_KEYS } from '@programs/error-tracking-upload-source-maps/detect';
import { preinstallPostHogCliOnce } from '@programs/shared/posthog-cli-preinstall';

const ui = {
  values: {} as Record<string, unknown>,
  setFrameworkContext: vi.fn(),
  warn: vi.fn(),
};

vi.mock('@programs/shared/posthog-cli-preinstall', () => ({
  preinstallPostHogCliOnce: vi.fn(),
}));

const host: ProgramRunHost = {
  getFrameworkContext: (key) => ui.values[key],
  setFrameworkContext: ui.setFrameworkContext,
  info: vi.fn(),
  warn: ui.warn,
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
};

const context = {
  projectId: 42,
  host: {
    apiHost: 'https://us.i.posthog.com',
    appHost: 'https://us.posthog.com',
  },
} as unknown as PromptContext;

beforeEach(() => {
  ui.values = {};
  ui.warn.mockClear();
  vi.mocked(preinstallPostHogCliOnce).mockClear();
});

it('reads the source-maps picker after legacy run resolution', async () => {
  const resolve = errorTrackingUploadSourceMapsConfig.run as (
    session: WizardSession,
    host: ProgramRunHost,
  ) => Promise<ProgramRun>;
  const run = await resolve({} as WizardSession, host);
  expect(run.customPrompt?.(context)).toContain(
    'Detection did not pick a source maps skill variant',
  );

  ui.values[SOURCE_MAPS_CONTEXT_KEYS.selectedVariant] = 'nextjs';
  ui.values[SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName] = 'Next.js';
  ui.values[SOURCE_MAPS_CONTEXT_KEYS.selectedPath] = 'apps/web';
  expect(run.customPrompt?.(context)).toContain('apps/web');
  expect(run.customPrompt?.(context)).toContain('Next.js');
});

it('preinstalls the global CLI only after a requiring variant is picked', async () => {
  const resolve = errorTrackingUploadSourceMapsConfig.run as (
    session: WizardSession,
    host: ProgramRunHost,
  ) => Promise<ProgramRun>;
  const run = await resolve({} as WizardSession, host);
  expect(preinstallPostHogCliOnce).not.toHaveBeenCalled();

  ui.values[SOURCE_MAPS_CONTEXT_KEYS.selectedVariant] = 'ios';
  run.customPrompt?.(context);
  expect(preinstallPostHogCliOnce).toHaveBeenCalledWith(
    'source maps posthog-cli preinstall failed',
    { variant: 'ios' },
    expect.any(Function),
  );
  const warn = vi.mocked(preinstallPostHogCliOnce).mock.calls[0]?.[2];
  warn?.('Preinstall warning');
  expect(ui.warn).toHaveBeenCalledWith('Preinstall warning');
});
