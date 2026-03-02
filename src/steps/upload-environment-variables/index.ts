import type { Integration } from '../../lib/constants';
import { traceStep } from '../../telemetry';
import { analytics } from '../../utils/analytics';
import { getUI } from '../../ui';
import type { WizardSession } from '../../lib/wizard-session';
import { EnvironmentProvider } from './EnvironmentProvider';
import { VercelEnvironmentProvider } from './providers/vercel';

export const uploadEnvironmentVariablesStep = async (
  envVars: Record<string, string>,
  {
    integration,
    session,
  }: {
    integration: Integration;
    session: WizardSession;
  },
): Promise<string[]> => {
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
    analytics.capture('wizard interaction', {
      action: 'not uploading environment variables',
      reason: 'no environment provider found',
      integration,
    });
    return [];
  }

  // Auto-accept — the agent already wrote env vars via MCP tools
  getUI().log.info(`Uploading environment variables to ${provider.name}...`);

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
