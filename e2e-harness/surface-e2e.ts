/**
 * Shared inputs and outputs for the surface e2e routes (`test:e2e:tui`, `test:e2e:programs`,
 * `test:e2e:agent`).
 *
 * Every route reads the same env: a PostHog personal key from
 * `POSTHOG_PERSONAL_API_KEY` or `POSTHOG_KEY_FILE`, a project from `PROJECT_ID`,
 * and an already-issued gateway token through `WIZARD_CI_GATEWAY_TOKEN_FILE`.
 * The TUI and programs routes take `APP_DIR` from the caller, normally the
 * wizard-workbench. The agent route makes its own empty directory.
 */
import fs from 'fs';
import {
  fetchProjectData,
  fetchUserData,
  type ApiProject,
  type ApiUser,
  type Credentials,
} from '@shared/api';
import { createCiGatewayAuth } from '@shared/ci-gateway-auth';
import { HostResolution } from '@shared/host-resolution';
import type { AgentProgress, InferenceAuthProvider } from '@agent/types';

export type E2eEnv = {
  /** Empty when the route makes its own working directory. */
  appDir: string;
  apiKey: string;
  projectId: number;
  gatewayTokenFile: string;
};

export type E2eCredentials = {
  posthog: Credentials;
  inferenceAuth: InferenceAuthProvider;
  project: ApiProject | null;
  apiUser: ApiUser | null;
};

/** A blank variable counts as unset, so the key file is the fallback. */
export function readPersonalApiKey(
  env: NodeJS.ProcessEnv,
  readFile: (file: string) => string = (file) => fs.readFileSync(file, 'utf8'),
): string {
  const inline = env.POSTHOG_PERSONAL_API_KEY?.trim();
  if (inline) return inline;
  const file = env.POSTHOG_KEY_FILE?.trim();
  return file ? readFile(file).trim() : '';
}

/** Throws one message listing every missing input, before any run starts. */
export function readE2eEnv(
  env: NodeJS.ProcessEnv,
  { needsAppDir = true }: { needsAppDir?: boolean } = {},
): E2eEnv {
  const missing: string[] = [];
  const appDir = env.APP_DIR?.trim() ?? '';
  if (needsAppDir && (!appDir || !fs.existsSync(appDir)))
    missing.push('APP_DIR: an existing app copy, prepared by the workbench');
  let apiKey = '';
  try {
    apiKey = readPersonalApiKey(env);
  } catch {
    // An unreadable key file is reported as a missing key below.
  }
  if (!apiKey)
    missing.push('POSTHOG_PERSONAL_API_KEY or a readable POSTHOG_KEY_FILE');
  const projectId = Number(env.PROJECT_ID);
  if (!Number.isInteger(projectId) || projectId <= 0)
    missing.push('PROJECT_ID: a positive project id');
  const gatewayTokenFile = env.WIZARD_CI_GATEWAY_TOKEN_FILE?.trim() ?? '';
  if (!gatewayTokenFile)
    missing.push(
      'WIZARD_CI_GATEWAY_TOKEN_FILE: an already-issued gateway token',
    );
  if (missing.length > 0)
    throw new Error(`Missing e2e inputs:\n- ${missing.join('\n- ')}`);
  return { appDir, apiKey, projectId, gatewayTokenFile };
}

/**
 * Resolve PostHog credentials from the personal key through shared modules
 * only, so the agent route loads nothing from programs, the TUI or the CLI.
 */
export async function resolveE2eCredentials(
  e2e: E2eEnv,
  env: NodeJS.ProcessEnv = process.env,
): Promise<E2eCredentials> {
  const host = await HostResolution.fromAccessToken(e2e.apiKey, {
    region: 'us',
  });
  const project = await fetchProjectData(
    e2e.apiKey,
    e2e.projectId,
    host.appHost,
  );
  const apiUser = await fetchUserData(e2e.apiKey, host.appHost).catch(
    () => null,
  );
  const token = fs.readFileSync(e2e.gatewayTokenFile, 'utf8');
  const gateway = createCiGatewayAuth(
    token,
    e2e.projectId,
    env.WIZARD_CI_GATEWAY_URL || 'https://ai-gateway.us.posthog.com',
  );
  return {
    posthog: {
      accessToken: e2e.apiKey,
      projectApiKey: project.api_token,
      host,
      projectId: e2e.projectId,
    },
    inferenceAuth: { resolve: () => Promise.resolve(gateway) },
    project,
    apiUser,
  };
}

/** Write the route's result where the workbench asserts on it, when asked. */
export function writeE2eResult(result: Record<string, unknown>): void {
  const file = process.env.E2E_RESULT_JSON;
  if (file) fs.writeFileSync(file, JSON.stringify(result, null, 2));
}

/** One line per progress event a person would want in a CI log. */
export function formatProgress(event: AgentProgress): string | null {
  switch (event.kind) {
    case 'log':
      return event.message;
    case 'status':
      return `status: ${event.message}`;
    case 'stage':
      return `stage: ${event.stage}`;
    case 'tasks':
      return `tasks: ${event.tasks
        .map((task) => `${task.status} ${task.content}`)
        .join(', ')}`;
    case 'url':
      return `${event.which}: ${event.url}`;
    case 'authError':
      return 'gateway rejected the inference token';
    default:
      return null;
  }
}
