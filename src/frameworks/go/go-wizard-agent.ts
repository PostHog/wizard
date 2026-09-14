/* Go wizard using posthog-agent with PostHog MCP */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardRunOptions } from '@utils/types';
import type { FrameworkConfig } from '@lib/framework-config';
import { goModulesPackageManager } from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';

type GoContext = {
  goVersion?: string;
};

function readGoMod(installDir: string): string | undefined {
  const goModPath = path.join(installDir, 'go.mod');
  if (!fs.existsSync(goModPath)) {
    return undefined;
  }
  return fs.readFileSync(goModPath, 'utf-8');
}

/** The `go 1.x` directive from go.mod (the toolchain floor, not a patch version). */
function getGoVersion(installDir: string): string | undefined {
  const goMod = readGoMod(installDir);
  return goMod?.match(/^go\s+([\d.]+)/m)?.[1];
}

export const GO_AGENT_CONFIG: FrameworkConfig<GoContext> = {
  metadata: {
    name: 'Go',
    integration: Integration.go,
    docsUrl: 'https://posthog.com/docs/libraries/go',
    gatherContext: (options: WizardRunOptions) => {
      const goVersion = getGoVersion(options.installDir);
      return Promise.resolve({ goVersion });
    },
  },

  detection: {
    packageName: 'posthog-go',
    packageDisplayName: 'Go',
    usesPackageJson: false,
    getVersion: () => undefined,
    // A go.mod with a module directive marks a Go module root; a bare
    // directory containing .go files without one is not integratable.
    detect: (options) => {
      const goMod = readGoMod(options.installDir);
      return Promise.resolve(!!goMod && /^module\s+\S+/m.test(goMod));
    },
    detectPackageManager: goModulesPackageManager,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      POSTHOG_API_KEY: apiKey,
      POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context) => ({
      goVersion: context.goVersion || 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a Go project. Look for go.mod, go.sum, cmd/, internal/, and main packages to confirm.',
    packageInstallation:
      'Install the PostHog Go SDK with `go get github.com/posthog/posthog-go`. Do not manually edit go.mod or go.sum; the go tool updates them automatically. Run `go mod tidy` afterwards if imports change.',
    getAdditionalContextLines: (context) => {
      const lines = [
        `Framework docs ID: go (use posthog://docs/frameworks/go for documentation)`,
      ];
      if (context.goVersion) {
        lines.push(`Go version (go.mod directive): ${context.goVersion}`);
      }
      lines.push(
        'Create one PostHog client per process and close it during graceful shutdown (`defer client.Close()`) so queued events flush.',
      );
      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [
      'Analyzed your Go project structure',
      'Installed the posthog-go SDK via go get',
      'Initialized a shared PostHog client configured from environment variables',
      'Instrumented meaningful server events with client.Enqueue(posthog.Capture{...})',
    ],
    getOutroNextSteps: () => [
      'Run your Go service and trigger the instrumented code paths',
      'Visit your PostHog dashboard to see incoming events',
      'Use client.Enqueue(posthog.Capture{...}) to track custom events',
      'Keep client.Close() in your graceful shutdown path so queued events flush',
    ],
  },
};
