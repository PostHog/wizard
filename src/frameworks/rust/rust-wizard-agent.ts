/* Rust wizard using posthog-agent with PostHog MCP */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardRunOptions } from '@utils/types';
import type { FrameworkConfig } from '@lib/framework-config';
import { cargoPackageManager } from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';

type RustContext = {
  asyncRuntime?: boolean;
};

function readCargoToml(installDir: string): string | undefined {
  const cargoTomlPath = path.join(installDir, 'Cargo.toml');
  if (!fs.existsSync(cargoTomlPath)) {
    return undefined;
  }
  return fs.readFileSync(cargoTomlPath, 'utf-8');
}

/** posthog-rs defaults to its async client; projects without an async runtime need the blocking one. */
function hasAsyncRuntime(installDir: string): boolean {
  const cargoToml = readCargoToml(installDir);
  return !!cargoToml && /^\s*(tokio|async-std|smol)\s*[=.]/m.test(cargoToml);
}

export const RUST_AGENT_CONFIG: FrameworkConfig<RustContext> = {
  metadata: {
    name: 'Rust',
    integration: Integration.rust,
    docsUrl: 'https://posthog.com/docs/libraries/rust',
    gatherContext: (options: WizardRunOptions) => {
      const asyncRuntime = hasAsyncRuntime(options.installDir);
      return Promise.resolve({ asyncRuntime });
    },
  },

  detection: {
    packageName: 'posthog-rs',
    packageDisplayName: 'Rust',
    usesPackageJson: false,
    getVersion: () => undefined,
    // A Cargo.toml with a [package] section marks a crate root. A
    // workspace-root-only manifest ([workspace], no [package]) falls
    // through — the agentic monorepo scan finds the nested crates.
    detect: (options) => {
      const cargoToml = readCargoToml(options.installDir);
      return Promise.resolve(!!cargoToml && /^\s*\[package\]/m.test(cargoToml));
    },
    detectPackageManager: cargoPackageManager,
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
      asyncRuntime: context.asyncRuntime ? 'true' : 'false',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a Rust project. Look for Cargo.toml with a [package] section, src/main.rs or src/lib.rs, and Cargo.lock to confirm.',
    packageInstallation:
      'Install the PostHog Rust SDK with `cargo add posthog-rs`. Do not manually edit Cargo.toml; cargo updates it automatically.',
    getAdditionalContextLines: (context) => {
      const lines = [
        `Framework docs ID: rust (use posthog://docs/frameworks/rust for documentation)`,
        'capture() hands events to a background worker — the client must flush() or shutdown() before the process exits or buffered events are lost.',
      ];
      if (context.asyncRuntime) {
        lines.push(
          'An async runtime is present — use the default async posthog-rs client.',
        );
      } else {
        lines.push(
          'No async runtime detected — install with `cargo add posthog-rs --no-default-features` and use the blocking client.',
        );
      }
      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [
      'Analyzed your Rust project structure',
      'Installed the posthog-rs crate via cargo add',
      'Initialized a shared PostHog client configured from environment variables',
      'Instrumented meaningful events with client.capture',
    ],
    getOutroNextSteps: () => [
      'Run your Rust application and trigger the instrumented code paths',
      'Visit your PostHog dashboard to see incoming events',
      'Use Event::new(event_name, distinct_id) and client.capture to track custom events',
      'Keep flush()/shutdown() in your exit path so queued events are sent',
    ],
  },
};
