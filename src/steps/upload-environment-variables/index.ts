import type { Integration } from '@lib/constants';
import { withProgress } from '../../telemetry';
import { analytics } from '@utils/analytics';
import { getUI } from '@ui';
import type { WizardSession } from '@lib/wizard-session';
import type { EnvUploadSkip } from './EnvironmentProvider';
import { EnvironmentProvider, EnvUploadSkipCause } from './EnvironmentProvider';
import { VercelEnvironmentProvider } from './providers/vercel';

export type EnvUploadOutcome = {
  uploadedKeys: string[];
  skip: EnvUploadSkip | null;
};

export const uploadEnvironmentVariablesStep = async (
  envVars: Record<string, string>,
  {
    integration,
    session,
  }: {
    integration: Integration;
    session: WizardSession;
  },
): Promise<EnvUploadOutcome> => {
  const providers: EnvironmentProvider[] = [
    new VercelEnvironmentProvider({ installDir: session.installDir }),
  ];

  let provider: EnvironmentProvider | null = null;

  for (const p of providers) {
    if (await p.detect()) {
      provider = p;
      break;
    }
  }

  if (!provider) {
    const keys = Object.keys(envVars);
    const skip =
      providers
        .map((p) => p.describeSkip(keys))
        .find((s): s is EnvUploadSkip => s !== null) ?? null;

    analytics.wizardCapture('env upload skipped', {
      reason: 'no environment provider found',
      integration,
      deploy_target: skip?.provider ?? null,
      skip_cause: skip?.cause ?? null,
    });

    if (skip) {
      getUI().log.warn(skip.message);
    }

    return { uploadedKeys: [], skip };
  }

  // Auto-accept — the agent already wrote env vars via MCP tools
  getUI().log.info(`Uploading environment variables to ${provider.name}...`);

  const results = await withProgress(
    'uploading environment variables',
    async () => {
      return await provider.uploadEnvVars(envVars);
    },
  );

  const uploadedKeys = Object.keys(results).filter((key) => results[key]);
  const attemptedKeys = Object.keys(envVars);

  if (uploadedKeys.length > 0) {
    analytics.wizardCapture('env uploaded', {
      provider: provider.name,
      integration,
    });

    return { uploadedKeys, skip: null };
  }

  // Partial success (some keys uploaded) is still success — only total
  // failure, with at least one key attempted, becomes a loud skip.
  if (attemptedKeys.length === 0) {
    return { uploadedKeys, skip: null };
  }

  const keyList = attemptedKeys.map((key) => `  - ${key}`).join('\n');
  const skip: EnvUploadSkip = {
    provider: provider.name,
    cause: EnvUploadSkipCause.UploadFailed,
    message: `The wizard found ${provider.name} but couldn't add the environment variables there — every upload failed. Add them under Settings → Environment Variables in your ${provider.name} project:

${keyList}

Until these are set in ${provider.name}, your deployed site won't send events to PostHog. The values are in your local .env file.`,
  };

  analytics.wizardCapture('env upload skipped', {
    reason: 'all uploads failed',
    integration,
    deploy_target: skip.provider,
    skip_cause: skip.cause,
  });

  getUI().log.warn(skip.message);

  return { uploadedKeys, skip };
};
