import type { Integration } from '../../lib/constants';
import { traceStep } from '../../telemetry';
import { analytics } from '../../utils/analytics';
import { getUI } from '../../ui';
import { abortIfCancelled } from '../../utils/setup-utils';
import type { WizardOptions } from '../../utils/types';
import { EnvironmentProvider } from './EnvironmentProvider';
import { VercelEnvironmentProvider } from './providers/vercel';

export const uploadEnvironmentVariablesStep = async (
  envVars: Record<string, string>,
  {
    integration,
    options,
  }: {
    integration: Integration;
    options: WizardOptions;
  },
): Promise<string[]> => {
  const providers: EnvironmentProvider[] = [
    new VercelEnvironmentProvider(options),
  ];

  let provider: EnvironmentProvider | null = null;

  for (const p of providers) {
    if (await p.detect()) {
      provider = p;
      break;
    }
  }

  if (!provider) {
    analytics.capture('wizard interaction', {
      action: 'not uploading environment variables',
      reason: 'no environment provider found',
      integration,
    });
    return [];
  }

  const upload: boolean = await abortIfCancelled(
    getUI().select({
      message: `It looks like you are using ${provider.name}. Would you like to upload the environment variables?`,
      options: [
        {
          value: true,
          label: 'Yes',
          hint: `Upload the environment variables to ${provider.name}`,
        },
        {
          value: false,
          label: 'No',
          hint: `Skip uploading environment variables to ${provider.name} - you can do this later`,
        },
      ],
    }),
    integration,
  );

  if (!upload) {
    analytics.capture('wizard interaction', {
      action: 'not uploading environment variables',
      reason: 'user declined to upload',
      provider: provider.name,
      integration,
    });
    return [];
  }

  const results = await traceStep(
    'uploading environment variables',
    async () => {
      return await provider.uploadEnvVars(envVars);
    },
  );

  analytics.capture('wizard interaction', {
    action: 'uploaded environment variables',
    provider: provider.name,
    integration,
  });

  return Object.keys(results).filter((key) => results[key]);
};
