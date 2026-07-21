import type { Mock } from 'vitest';

const { mockWarn, mockInfo, mockWizardCapture } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockInfo: vi.fn(),
  mockWizardCapture: vi.fn(),
}));

vi.mock('@ui', () => ({
  getUI: () => ({
    log: { info: mockInfo, warn: mockWarn, error: vi.fn(), success: vi.fn() },
    spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  }),
}));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: mockWizardCapture, setTag: vi.fn() },
}));
vi.mock('../../telemetry', () => ({
  withProgress: (_label: string, fn: () => unknown) => fn(),
}));

import { uploadEnvironmentVariablesStep } from '@steps/upload-environment-variables';
import {
  EnvUploadSkipCause,
  type EnvUploadSkip,
} from '@steps/upload-environment-variables/EnvironmentProvider';
import { VercelEnvironmentProvider } from '@steps/upload-environment-variables/providers/vercel';

const ENV_VARS = {
  NEXT_PUBLIC_POSTHOG_KEY: 'phc_secret_value',
  NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
};

const stepArgs = {
  integration: 'nextjs' as never,
  session: { installDir: '/tmp/project' } as never,
};

function stubVercel(options: {
  detected: boolean;
  skip?: EnvUploadSkip | null;
  uploads?: Record<string, boolean>;
}): void {
  vi.spyOn(VercelEnvironmentProvider.prototype, 'detect').mockResolvedValue(
    options.detected,
  );
  vi.spyOn(VercelEnvironmentProvider.prototype, 'describeSkip').mockReturnValue(
    options.skip ?? null,
  );
  vi.spyOn(
    VercelEnvironmentProvider.prototype,
    'uploadEnvVars',
  ).mockResolvedValue(options.uploads ?? {});
}

const VERCEL_SKIP: EnvUploadSkip = {
  provider: 'Vercel',
  cause: EnvUploadSkipCause.CliMissing,
  message: 'Your project appears to deploy to Vercel, but ...',
};

describe('uploadEnvironmentVariablesStep', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('should warn and report the skip when a Vercel-marked project cannot be uploaded to', async () => {
    stubVercel({ detected: false, skip: VERCEL_SKIP });

    const outcome = await uploadEnvironmentVariablesStep(ENV_VARS, stepArgs);

    expect(outcome).toEqual({ uploadedKeys: [], skip: VERCEL_SKIP });
    expect(mockWarn).toHaveBeenCalledWith(VERCEL_SKIP.message);
  });

  it('should stay quiet when the project shows no deploy markers', async () => {
    stubVercel({ detected: false, skip: null });

    const outcome = await uploadEnvironmentVariablesStep(ENV_VARS, stepArgs);

    expect(outcome).toEqual({ uploadedKeys: [], skip: null });
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('should tag the skip event with the deploy target and cause', async () => {
    stubVercel({ detected: false, skip: VERCEL_SKIP });

    await uploadEnvironmentVariablesStep(ENV_VARS, stepArgs);

    expect(mockWizardCapture).toHaveBeenCalledWith(
      'env upload skipped',
      expect.objectContaining({
        deploy_target: 'Vercel',
        skip_cause: EnvUploadSkipCause.CliMissing,
      }),
    );
  });

  it('should record a null deploy target for non-Vercel projects', async () => {
    stubVercel({ detected: false, skip: null });

    await uploadEnvironmentVariablesStep(ENV_VARS, stepArgs);

    expect(mockWizardCapture).toHaveBeenCalledWith(
      'env upload skipped',
      expect.objectContaining({ deploy_target: null, skip_cause: null }),
    );
  });

  it('should pass the provider only the key names to warn about', async () => {
    stubVercel({ detected: false, skip: VERCEL_SKIP });

    await uploadEnvironmentVariablesStep(ENV_VARS, stepArgs);

    expect(
      VercelEnvironmentProvider.prototype.describeSkip as unknown as Mock,
    ).toHaveBeenCalledWith(Object.keys(ENV_VARS));
  });

  it('should return the uploaded keys when a provider is detected', async () => {
    stubVercel({
      detected: true,
      uploads: {
        NEXT_PUBLIC_POSTHOG_KEY: true,
        NEXT_PUBLIC_POSTHOG_HOST: false,
      },
    });

    const outcome = await uploadEnvironmentVariablesStep(ENV_VARS, stepArgs);

    expect(outcome).toEqual({
      uploadedKeys: ['NEXT_PUBLIC_POSTHOG_KEY'],
      skip: null,
    });
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('should not fire "env uploaded" when every upload fails', async () => {
    stubVercel({
      detected: true,
      uploads: {
        NEXT_PUBLIC_POSTHOG_KEY: false,
        NEXT_PUBLIC_POSTHOG_HOST: false,
      },
    });

    await uploadEnvironmentVariablesStep(ENV_VARS, stepArgs);

    expect(mockWizardCapture).not.toHaveBeenCalledWith(
      'env uploaded',
      expect.anything(),
    );
  });

  it('should fire "env uploaded" when at least one key is uploaded', async () => {
    stubVercel({
      detected: true,
      uploads: {
        NEXT_PUBLIC_POSTHOG_KEY: true,
        NEXT_PUBLIC_POSTHOG_HOST: false,
      },
    });

    await uploadEnvironmentVariablesStep(ENV_VARS, stepArgs);

    expect(mockWizardCapture).toHaveBeenCalledWith('env uploaded', {
      provider: 'Vercel',
      integration: 'nextjs',
    });
  });

  it('should return a loud skip when every upload fails despite a detected provider', async () => {
    stubVercel({
      detected: true,
      uploads: {
        NEXT_PUBLIC_POSTHOG_KEY: false,
        NEXT_PUBLIC_POSTHOG_HOST: false,
      },
    });

    const outcome = await uploadEnvironmentVariablesStep(ENV_VARS, stepArgs);

    expect(outcome.uploadedKeys).toEqual([]);
    expect(outcome.skip).toEqual(
      expect.objectContaining({
        provider: 'Vercel',
        cause: EnvUploadSkipCause.UploadFailed,
      }),
    );
    expect(outcome.skip?.message).toContain('NEXT_PUBLIC_POSTHOG_KEY');
    expect(outcome.skip?.message).toContain('NEXT_PUBLIC_POSTHOG_HOST');
    expect(mockWarn).toHaveBeenCalledWith(outcome.skip?.message);
  });

  it('should tag the upload-failed skip event with the provider and cause', async () => {
    stubVercel({
      detected: true,
      uploads: {
        NEXT_PUBLIC_POSTHOG_KEY: false,
        NEXT_PUBLIC_POSTHOG_HOST: false,
      },
    });

    await uploadEnvironmentVariablesStep(ENV_VARS, stepArgs);

    expect(mockWizardCapture).toHaveBeenCalledWith(
      'env upload skipped',
      expect.objectContaining({
        reason: 'all uploads failed',
        deploy_target: 'Vercel',
        skip_cause: EnvUploadSkipCause.UploadFailed,
      }),
    );
  });

  it('should not return a skip when a provider is detected but there were no env vars to upload', async () => {
    stubVercel({ detected: true, uploads: {} });

    const outcome = await uploadEnvironmentVariablesStep({}, stepArgs);

    expect(outcome).toEqual({ uploadedKeys: [], skip: null });
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
