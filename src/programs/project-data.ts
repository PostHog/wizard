import * as childProcess from 'node:child_process';
import { basename } from 'node:path';

import { withProgress } from '@utils/telemetry';
import { logToFile } from '@utils/debug';
import type { CloudRegion, WizardRunOptions } from '@utils/types';
import { DUMMY_PROJECT_API_KEY, ISSUES_URL } from '@shared/constants';
import {
  getOAuthScopesForProgram,
  getProvisioningScopesForProgram,
} from './oauth/program-scopes';
import type { ProgramId } from './program-registry';
import { analytics } from '@utils/analytics';
import { HostResolution } from '@shared/host-resolution';
import {
  assertWizardCompletionScope,
  missingOAuthScopes,
  performOAuthFlow,
  type OAuthFlowHost,
} from '@utils/oauth';
import { resolveGrantedProject } from '@utils/project-resolution';
import {
  ProvisionedAccountUnreadableError,
  provisionNewAccount,
} from '@utils/provisioning';
import {
  fetchUserData,
  fetchProjectData,
  type ApiUser,
  type ApiProject,
} from '@shared/api';
import type { HostFailure } from './host-capabilities';
import { OutroKind } from '@agent';

interface ProjectData {
  projectApiKey: string;
  accessToken: string;
  /** OAuth refresh token when the grant carried one; absent on the CI api-key path. */
  refreshToken?: string;
  /** Epoch ms when `accessToken` expires; absent on the CI api-key path. */
  expiresAt?: number;
  /** Minting OAuth client when it differs from the default login app (provisioning signups). */
  oauthClientId?: string;
  host: HostResolution;
  distinctId: string;
  projectId: number;
  /**
   * Optional `role_at_organization` from `/api/users/@me/`. Drives the
   * role-tailored prompt suggestions on the McpSuggestedPromptsScreen. Null
   * for signup flows (no role picked yet) and older accounts.
   */
  roleAtOrganization?: string | null;
  /**
   * Full user payload from `/api/users/@me/`. Carried through so
   * `getOrAskForProjectData` can forward it to the session as
   * `session.apiUser`. Null when the request failed or the CI key
   * lacked permissions.
   */
  user?: ApiUser | null;
  /**
   * Full project payload from `/api/projects/:id/`. Carries the team's
   * product opt-ins (replay, exception autocapture, surveys) so prompts
   * can state project-level product enablement instead of agents
   * inferring it from repo evidence. Null on signup flows.
   */
  project?: ApiProject | null;
  /**
   * Requested OAuth scopes the grant came back without (consent deselection
   * or ceiling clamp). Forwarded to `session.credentials.missingScopes` so
   * runs can degrade scope-gated steps instead of failing on a 403. Empty on
   * CI api-key and signup-provisioning paths.
   */
  missingScopes?: readonly string[];
}

/** What resolving project data needs from its host: the OAuth flow's needs, success lines and abort. */
export type ProjectDataHost = Omit<OAuthFlowHost, 'log' | 'abort'> & {
  log: OAuthFlowHost['log'] & { success(message: string): void };
  abort(failure?: HostFailure): Promise<never>;
};

const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mail.com',
  'protonmail.com',
  'proton.me',
  'live.com',
  'aol.com',
  'yandex.com',
  'zoho.com',
  'gmx.com',
  'fastmail.com',
]);

function parseGitRemote(): { org: string; repo: string } | null {
  try {
    const url = childProcess
      .execSync('git remote get-url origin', {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString()
      .trim();
    // git@github.com:acme-corp/my-app.git or https://github.com/acme-corp/my-app.git
    const match = url.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (match) return { org: match[1], repo: match[2] };
  } catch {
    // not in a git repo or no remote
  }
  return null;
}

export function detectOrgAndProject(email: string): {
  orgName: string | undefined;
  projectName: string | undefined;
} {
  const remote = parseGitRemote();

  // Project name: git repo name > directory name
  const projectName = remote?.repo || basename(process.cwd()) || undefined;

  // Org name: git remote org > email domain (skip freemail)
  let orgName: string | undefined;
  if (remote?.org) {
    orgName = remote.org;
  } else {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && !FREEMAIL_DOMAINS.has(domain)) {
      orgName = domain.split('.')[0];
    }
  }

  return { orgName, projectName };
}

/**
 * Detect and return the package manager. Pure — no prompts.
 * Falls back to first detected or npm if ambiguous.
 */

/**
 * Get project data for the wizard via OAuth or CI API key.
 */
export async function getOrAskForProjectData(
  _options: Pick<WizardRunOptions, 'signup' | 'ci' | 'apiKey' | 'projectId'> & {
    email?: string;
    region?: CloudRegion;
    /** Explicit base URL override (`--base-url`, from `session.baseUrl`). When
     *  set, pins every PostHog origin and bypasses region resolution. */
    baseUrl?: string;
    /** `--local-mcp`: forwarded into the resolved host so `host.mcpUrl` is local. */
    localMcp?: boolean;
    /** Optional — picks the OAuth scope set via
     *  `getOAuthScopesForProgram`. Omitted → default
     *  `WIZARD_OAUTH_SCOPES`. Threaded into `askForWizardLogin`. */
    programId?: ProgramId | null;
  },
  ui: ProjectDataHost,
): Promise<{
  host: HostResolution;
  projectApiKey: string;
  accessToken: string;
  /** OAuth refresh token when the grant carried one; absent on the CI api-key path. */
  refreshToken?: string;
  /** Epoch ms when `accessToken` expires; absent on the CI api-key path. */
  expiresAt?: number;
  /** Minting OAuth client when it differs from the default login app (provisioning signups). */
  oauthClientId?: string;
  projectId: number;
  roleAtOrganization: string | null;
  user: ApiUser | null;
  project: ApiProject | null;
  /** Requested OAuth scopes the grant came back without. Empty on CI/signup paths. */
  missingScopes: readonly string[];
}> {
  // CI mode: bypass OAuth, use personal API key for LLM gateway
  if (_options.ci && _options.apiKey) {
    ui.log.info('Using provided API key (CI mode - OAuth bypassed)');

    const host = await HostResolution.fromAccessToken(_options.apiKey, {
      region: _options.region,
      localMcp: _options.localMcp,
      baseUrl: _options.baseUrl,
    });
    const cloudUrl = host.appHost;

    const projectData =
      _options.projectId != null
        ? await fetchProjectDataById(
            _options.apiKey,
            _options.projectId,
            cloudUrl,
          )
        : await fetchProjectDataWithApiKey(_options.apiKey, cloudUrl);

    // Best-effort user fetch — CI flows may run with project-scoped keys
    // that 403 on /api/users/@me/, so swallow errors and continue with
    // a null user (and null role).
    let user: ApiUser | null = null;
    let roleAtOrganization: string | null = null;
    try {
      user = await fetchUserData(_options.apiKey, cloudUrl);
      roleAtOrganization = user.role_at_organization ?? null;
    } catch (err) {
      logToFile(
        '[ci-auth] user lookup failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
    if (user) {
      analytics.identifyUser(user);
      logToFile(
        '[ci-auth] identified via API key; flags evaluate as the key owner',
      );
    } else {
      ui.log.warn(
        'Could not resolve the API key user (key needs user:read scope) — feature flags evaluate anonymously; user-targeted flags will not match.',
      );
    }

    return {
      host,
      projectApiKey: projectData.api_token,
      accessToken: _options.apiKey,
      projectId: projectData.id,
      roleAtOrganization,
      user,
      project: projectData.project,
      // A personal API key carries whatever scopes it carries — there is no
      // per-run scope request to diff against.
      missingScopes: [],
    };
  }

  const {
    host,
    projectApiKey,
    accessToken,
    refreshToken,
    expiresAt,
    oauthClientId,
    projectId,
    roleAtOrganization,
    user,
    project,
    missingScopes,
  } = await withProgress('login', () =>
    askForWizardLogin(
      {
        signup: _options.signup,
        email: _options.email,
        region: _options.region,
        baseUrl: _options.baseUrl,
        programId: _options.programId,
        projectId: _options.projectId,
        localMcp: _options.localMcp,
      },
      ui,
    ),
  );

  if (!projectApiKey) {
    const cloudUrl = host.appHost;
    ui.log.error(`Didn't receive a project token. This shouldn't happen :(

Please let us know if you think this is a bug in the wizard:
${ISSUES_URL}`);

    ui.log
      .info(`In the meantime, we'll add a dummy project token ("${DUMMY_PROJECT_API_KEY}") for you to replace later.
You can find your project token here:
${cloudUrl}/settings/project#variables`);
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    oauthClientId,
    host,
    projectApiKey: projectApiKey || DUMMY_PROJECT_API_KEY,
    projectId,
    roleAtOrganization: roleAtOrganization ?? null,
    user: user ?? null,
    project: project ?? null,
    missingScopes: missingScopes ?? [],
  };
}

async function fetchProjectDataWithApiKey(
  apiKey: string,
  cloudUrl: string,
): Promise<{ api_token: string; id: number; project: ApiProject }> {
  const userData = await fetchUserData(apiKey, cloudUrl);
  const projectId = userData.team?.id;

  if (!projectId) {
    throw new Error(
      'Could not determine project ID from API key. Please ensure your API key has access to a project in this cloud region.',
    );
  }

  const projectData = await fetchProjectData(apiKey, projectId, cloudUrl);
  return {
    api_token: projectData.api_token,
    id: projectId,
    project: projectData,
  };
}

async function fetchProjectDataById(
  apiKey: string,
  projectId: number,
  cloudUrl: string,
): Promise<{ api_token: string; id: number; project: ApiProject }> {
  const projectData = await fetchProjectData(apiKey, projectId, cloudUrl);
  return {
    api_token: projectData.api_token,
    id: projectId,
    project: projectData,
  };
}

async function askForWizardLogin(
  options: {
    signup: boolean;
    email?: string;
    region?: CloudRegion;
    /** Explicit base URL override (`--base-url`); pins every PostHog origin. */
    baseUrl?: string;
    /** Used to pick the right scope set via `getOAuthScopesForProgram`.
     *  Omitted → default `WIZARD_OAUTH_SCOPES`. */
    programId?: ProgramId | null;
    /** `--project-id`, if passed. When the user granted access to it on the consent
     *  screen we use it directly; otherwise we fall back to the first granted team. */
    projectId?: number;
    /** `--local-mcp`: forwarded into the resolved host so `host.mcpUrl` is local. */
    localMcp?: boolean;
  },
  ui: ProjectDataHost,
): Promise<ProjectData> {
  if (options.signup) {
    return askForProvisioningSignup(
      ui,
      options.email,
      options.region,
      options.baseUrl,
      options.localMcp,
      options.programId,
    );
  }

  const requestedScopes = [...getOAuthScopesForProgram(options.programId)];
  const tokenResponse = await performOAuthFlow(
    {
      scopes: requestedScopes,
      signup: false,
      projectId: options.projectId,
      baseUrl: options.baseUrl,
    },
    ui,
  );

  try {
    assertWizardCompletionScope(tokenResponse.scope);
  } catch (error) {
    const scopeError =
      error instanceof Error ? error : new Error('OAuth scope check failed');
    const missing = missingOAuthScopes(requestedScopes, tokenResponse.scope);
    analytics.captureException(scopeError, {
      step: 'wizard_login',
      missing_scope: 'event_definition:write',
    });
    await ui.abort({
      message: scopeError.message,
      outroData: {
        kind: OutroKind.Error,
        message: 'Setup needs permissions that were not granted',
        body: [
          'Missing permissions:',
          ...missing.map((scope) => `  • ${scope}`),
          '',
          'Re-run the wizard and approve all permissions on the PostHog authorization screen.',
          'If that screen does not reappear, revoke the existing PostHog Wizard authorization in your PostHog settings first.',
        ].join('\n'),
      },
    });
  }

  // `--project-id`, when provided, is authoritative — but only if the user actually
  // granted access to it on the consent screen. If they authorized a different
  // project, fail loudly instead of silently capturing into the wrong one. With no
  // `--project-id` this falls back to the granted project, unchanged for every program.
  const resolution = resolveGrantedProject(
    options.projectId,
    tokenResponse.scoped_teams,
  );
  if (!resolution.ok) {
    const error = new Error(
      `You authorized project ${resolution.granted}, but setup is targeting project ${resolution.requested} (from --project-id). ` +
        `If ${resolution.requested} is not a project you own — a copy-pasted example value, say — re-run without --project-id, or with the id shown in your PostHog project settings. ` +
        `If it is yours, re-run and grant access to project ${resolution.requested} on the authorization screen.`,
    );
    analytics.captureException(error, {
      step: 'wizard_login',
      requested_project_id: resolution.requested,
      granted_project_id: resolution.granted,
    });
    ui.log.error(error.message);
    await ui.abort({ message: error.message });
  }

  const projectId = resolution.ok ? resolution.projectId : undefined;

  if (projectId === undefined) {
    const error = new Error(
      'No project access granted. Please authorize with project-level access.',
    );
    analytics.captureException(error, {
      step: 'wizard_login',
      has_scoped_teams: !!tokenResponse.scoped_teams,
    });
    ui.log.error(error.message);
    await ui.abort({ message: error.message });
  }

  // The issuing region comes with the token; the us/eu @me probe only runs when omitted.
  const host = await HostResolution.fromAccessToken(
    tokenResponse.access_token,
    {
      region: tokenResponse.posthog_region,
      localMcp: options.localMcp,
      baseUrl: options.baseUrl,
    },
  );
  const cloudUrl = host.appHost;

  const projectData = await fetchProjectData(
    tokenResponse.access_token,
    projectId!,
    cloudUrl,
  );
  const userData = await fetchUserData(tokenResponse.access_token, cloudUrl);

  const data = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
    projectApiKey: projectData.api_token,
    host,
    distinctId: userData.distinct_id,
    projectId: projectId!,
    roleAtOrganization: userData.role_at_organization ?? null,
    user: userData,
    project: projectData,
    // What the user declined at consent (or the ceiling clamped) — carried to
    // the session so runs degrade scope-gated steps instead of 403ing blind.
    missingScopes: missingOAuthScopes(requestedScopes, tokenResponse.scope),
  };

  ui.log.success('Login complete.');
  analytics.setTag('opened-wizard-link', true);
  analytics.identifyUser(userData);

  return data;
}

async function askForProvisioningSignup(
  ui: ProjectDataHost,
  email?: string,
  region?: CloudRegion,
  baseUrl?: string,
  localMcp?: boolean,
  programId?: ProgramId | null,
): Promise<ProjectData> {
  if (!email || !email.includes('@')) {
    ui.log.error(
      'Email is required for signup. Use --email your@email.com with --signup.',
    );
    await ui.abort();
    throw new Error('unreachable');
  }

  const spinner = ui.spinner();
  spinner.start('Creating your PostHog account...');

  try {
    const provisionRegion = (region ?? 'us').toUpperCase() as 'US' | 'EU';
    const { orgName, projectName } = detectOrgAndProject(email);
    const result = await provisionNewAccount(email, '', provisionRegion, {
      orgName,
      projectName,
      baseUrl,
      scopes: getProvisioningScopesForProgram(programId),
    });

    spinner.stop('Account created!');
    ui.log.success('Welcome to PostHog!');

    const host = HostResolution.fromApiHost(result.host, { localMcp });

    analytics.setTag('provisioning-signup', true);

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      oauthClientId: result.oauthClientId,
      projectApiKey: result.projectApiKey,
      host,
      distinctId: email,
      projectId: parseInt(result.projectId, 10) || 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // The account exists — reporting a failed signup would send the user off to create a
    // second one on top of the org they already own.
    if (error instanceof ProvisionedAccountUnreadableError) {
      spinner.stop('Account created, but the project could not be read back.');
      ui.log.warn(message);
      ui.log.info('Signing you in to your new account instead...');

      return askForWizardLogin({ signup: false, baseUrl, localMcp }, ui);
    }

    spinner.stop('Account creation failed.');

    if (message.includes('already associated')) {
      ui.log.info(
        'This email already has a PostHog account. Switching to login flow...',
      );

      return askForWizardLogin({ signup: false, baseUrl, localMcp }, ui);
    }

    ui.log.error(`Failed to create account: ${message}`);
    analytics.captureException(
      error instanceof Error ? error : new Error(message),
      { step: 'provisioning_signup' },
    );
    await ui.abort();
    throw error;
  }
}
