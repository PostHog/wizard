import { execSync, spawn, spawnSync } from 'child_process';
import {
  EnvironmentProvider,
  EnvUploadSkipCause,
  type EnvUploadSkip,
} from '@steps/upload-environment-variables/EnvironmentProvider';
import * as fs from 'fs';
import * as path from 'path';
import { getUI } from '@ui';
import { analytics } from '@utils/analytics';

type EnvAddResult = { code: number | null; stderr: string };

const ALREADY_EXISTS_MARKERS = [
  'already exists',
  'already been added',
  'vercel env rm',
];

const REMEDY_BY_CAUSE: Record<EnvUploadSkipCause, string> = {
  [EnvUploadSkipCause.CliMissing]:
    "the Vercel CLI isn't installed. Install it with `npm i -g vercel`, run `vercel link`, then:",
  [EnvUploadSkipCause.ProjectUnlinked]:
    "this directory isn't linked to a Vercel project. Run `vercel link`, then:",
  [EnvUploadSkipCause.Unauthenticated]:
    "you're not logged in to the Vercel CLI. Run `vercel login`, then:",
};

export class VercelEnvironmentProvider extends EnvironmentProvider {
  name = 'Vercel';
  environments = ['production', 'preview', 'development'];

  private checks: {
    hasCli: boolean;
    isLinked: boolean;
    isAuthenticated: boolean;
  } | null = null;

  constructor(options: { installDir: string }) {
    super(options);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async detect(): Promise<boolean> {
    const hasCli = this.hasVercelCli();
    const isLinked = hasCli && this.isProjectLinked();
    const isAuthenticated = isLinked && this.isAuthenticated();

    this.checks = { hasCli, isLinked, isAuthenticated };

    const vercelDetected = hasCli && isLinked && isAuthenticated;

    analytics.setTag('vercel-detected', vercelDetected);
    analytics.setTag('vercel-markers-found', this.hasDeployMarkers());

    return vercelDetected;
  }

  /**
   * Cheap filesystem signal that the project deploys to Vercel, independent of
   * whether the CLI is usable — `detect()` can't tell "not a Vercel project"
   * apart from "Vercel project the wizard can't reach".
   */
  hasDeployMarkers(): boolean {
    return (
      this.hasDotVercelDir() ||
      fs.existsSync(path.join(this.options.installDir, 'vercel.json'))
    );
  }

  hasDotVercelDir(): boolean {
    const dotVercelDir = path.join(this.options.installDir, '.vercel');
    return fs.existsSync(dotVercelDir);
  }

  hasVercelCli(): boolean {
    try {
      execSync('vercel --version', { stdio: 'ignore' });
      analytics.setTag('vercel-cli-installed', true);
      return true;
    } catch {
      analytics.setTag('vercel-cli-installed', false);
      return false;
    }
  }

  isProjectLinked(): boolean {
    const isProjectLinked = fs.existsSync(
      path.join(this.options.installDir, '.vercel', 'project.json'),
    );

    analytics.setTag('vercel-project-linked', isProjectLinked);

    return isProjectLinked;
  }

  isAuthenticated(): boolean {
    const result = spawnSync('vercel', ['whoami'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'], // suppress prompts
      env: {
        ...process.env,
        FORCE_COLOR: '0', // avoid ANSI formatting
        CI: '1', // hint to CLI that it's a non-interactive env
      },
    });

    const output = (
      String(result.stdout) + String(result.stderr)
    ).toLowerCase();

    if (
      output.includes('log in to vercel') ||
      output.includes('vercel login') ||
      result.status !== 0
    ) {
      analytics.setTag('vercel-authenticated', false);
      return false;
    }

    analytics.setTag('vercel-authenticated', true);

    return true;
  }

  describeSkip(keys: string[]): EnvUploadSkip | null {
    if (!this.checks || !this.hasDeployMarkers()) return null;

    const cause = this.skipCause();
    if (!cause) return null;

    const keyList = keys.map((key) => `  - ${key}`).join('\n');
    const addCommands = keys
      .map((key) => `  vercel env add ${key} production`)
      .join('\n');

    return {
      provider: this.name,
      cause,
      message: `Your project appears to deploy to ${this.name}, but the wizard couldn't upload environment variables — ${REMEDY_BY_CAUSE[cause]}

${addCommands}

Until these are set in ${this.name}, your deployed site won't send events to PostHog. You can also add them under Settings → Environment Variables in your ${this.name} project:

${keyList}

The values are in your local .env file.`,
    };
  }

  private skipCause(): EnvUploadSkipCause | null {
    if (!this.checks) return null;
    if (!this.checks.hasCli) return EnvUploadSkipCause.CliMissing;
    if (!this.checks.isLinked) return EnvUploadSkipCause.ProjectUnlinked;
    if (!this.checks.isAuthenticated) return EnvUploadSkipCause.Unauthenticated;
    return null;
  }

  private runEnvAdd(
    key: string,
    value: string,
    environment: string,
  ): Promise<EnvAddResult> {
    return new Promise<EnvAddResult>((resolve, reject) => {
      const proc = spawn('vercel', ['env', 'add', key, environment], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.stdin.write(value);
      proc.stdin.end();

      proc.on('error', reject);
      proc.on('close', (code) => resolve({ code, stderr }));
    });
  }

  private removeEnvironmentVariable(
    key: string,
    environment: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proc = spawn('vercel', ['env', 'rm', key, environment, '-y'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.on('error', reject);
      proc.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `❌ Failed to replace existing environment variable ${key} in ${this.name}. Please upload it manually.`,
              ),
            ),
      );
    });
  }

  async uploadEnvironmentVariable(
    key: string,
    value: string,
    environment: string,
  ): Promise<void> {
    const added = await this.runEnvAdd(key, value, environment);
    if (added.code === 0) return;

    const alreadyExists = ALREADY_EXISTS_MARKERS.some((marker) =>
      added.stderr.includes(marker),
    );
    if (!alreadyExists) {
      throw new Error(
        `❌ Failed to upload environment variable ${key} to ${this.name}. Please upload it manually.`,
      );
    }

    // Vercel has no upsert for env vars, so replace the stale value.
    await this.removeEnvironmentVariable(key, environment);

    const readded = await this.runEnvAdd(key, value, environment);
    if (readded.code !== 0) {
      throw new Error(
        `❌ Failed to update existing environment variable ${key} in ${this.name}. Please upload it manually.`,
      );
    }
  }

  async uploadEnvVars(
    vars: Record<string, string>,
  ): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [key, value] of Object.entries(vars)) {
      const spinner = getUI().spinner();

      spinner.start(`Uploading ${key} to ${this.name}...`);
      await Promise.all(
        this.environments.map((environment) =>
          this.uploadEnvironmentVariable(key, value, environment),
        ),
      )
        .then(() => {
          spinner.stop(`✅ Uploaded ${key} to ${this.name}`);
          results[key] = true;
        })
        .catch((err) => {
          spinner.stop(
            err instanceof Error
              ? err.message
              : `❌ Failed to upload environment variables to ${this.name}. Please upload it manually.`,
          );
          results[key] = false;
        });
    }

    return results;
  }
}
