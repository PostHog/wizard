import type { Integration } from '@shared/config/constants';
import { withProgress } from '@utils/telemetry';
import { analytics } from '@utils/analytics';
import {
  EnvironmentProvider,
  type EnvUploadReport,
} from './EnvironmentProvider';
import { VercelEnvironmentProvider } from './providers/vercel';

export const uploadEnvironmentVariablesStep = async (
  envVars: Record<string, string>,
  {
    integration,
    installDir,
    report,
  }: {
    integration: Integration;
    installDir: string;
    report: EnvUploadReport;
  },
): Promise<string[]> => {
  const providers: EnvironmentProvider[] = [
    new VercelEnvironmentProvider({ installDir, report }),
  ];

  let provider: EnvironmentProvider | null = null;

  for (const p of providers) {
    if (await p.detect()) {
      provider = p;
      break;
    }
  }

  if (!provider) {
    analytics.wizardCapture('env upload skipped', {
      reason: 'no environment provider found',
      integration,
    });
    return [];
  }

  // Auto-accept — the agent already wrote env vars via MCP tools
  report.info(`Uploading environment variables to ${provider.name}...`);

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

  return Object.keys(results).filter((key) => results[key]);
};
