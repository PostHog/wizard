import type { Integration } from '@lib/constants';
import { withProgress } from '../../telemetry';
import { analytics } from '@utils/analytics';
import { getUI } from '@ui';
import type { WizardSession } from '@lib/wizard-session';
import type { EnvUploadSkip } from './EnvironmentProvider';
import { EnvironmentProvider } from './EnvironmentProvider';
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

  analytics.wizardCapture('env uploaded', {
    provider: provider.name,
    integration,
  });

  return {
    uploadedKeys: Object.keys(results).filter((key) => results[key]),
    skip: null,
  };
};
