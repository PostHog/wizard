/**
 * Login: resolve the PostHog credentials and project for a run, through the
 * browser OAuth flow, a CI API key, or a provisioning signup. UI-bound, so it
 * lives with the TUI's store; programs receive credentials, never log in.
 */

import { withProgress } from '@utils/telemetry';
import type { CloudRegion, WizardRunOptions } from '@utils/types';
import {
  DUMMY_PROJECT_API_KEY,
  ISSUES_URL,
  WIZARD_OAUTH_SCOPES,
  WIZARD_PROVISIONING_SCOPES,
} from '@shared/constants';
import { withScopeAdditions } from '@shared/oauth-scopes';
import {
  getOAuthScopesForProgram,
  getProvisioningScopesForProgram,
} from '@programs';
import type { ProgramId } from '@programs/types';
import { resolveApiKeyLogin } from '@programs';
import { analytics } from '@utils/analytics';
import type { WizardStore } from '@tui/store';
import { HostResolution } from '@shared/host-resolution';
import { performOAuthFlow } from '@tui/auth/oauth-flow';
import { detectOrgAndProject } from '@utils/setup-utils';
import { missingOAuthScopes } from '@programs';
import { assertWizardCompletionScope } from './oauth.js';
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
import { abortOnScreens } from '@tui/abort';
import { OutroKind } from '@shared/outro';

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

/**
 * Get project data for the wizard via OAuth or CI API key.
 */
export async function getOrAskForProjectData(
  _options: Pick<WizardRunOptions, 'signup' | 'ci' | 'apiKey' | 'projectId'> & {
    /** Where login progress and errors are shown. */
    store: WizardStore;
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
    /** A tool's or a screen's own widening of the base scopes; wins over `programId`'s. */
    scopeAdditions?: readonly string[];
  },
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
  const { store } = _options;
  // CI mode: bypass OAuth, use personal API key for LLM gateway
  if (_options.ci && _options.apiKey) {
    store.pushStatus('Using provided API key (CI mode - OAuth bypassed)');

    const login = await resolveApiKeyLogin(_options.apiKey, {
      region: _options.region,
      localMcp: _options.localMcp,
      baseUrl: _options.baseUrl,
      projectId: _options.projectId,
      onWarning: (message) => store.pushStatus(message),
    });
    return {
      host: login.posthog.host,
      projectApiKey: login.posthog.projectApiKey,
      accessToken: login.posthog.accessToken,
      projectId: login.posthog.projectId,
      roleAtOrganization: login.roleAtOrganization,
      user: login.apiUser,
      project: login.project,
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
    askForWizardLogin({
      store,
      signup: _options.signup,
      email: _options.email,
      region: _options.region,
      baseUrl: _options.baseUrl,
      programId: _options.programId,
      scopeAdditions: _options.scopeAdditions,
      projectId: _options.projectId,
      localMcp: _options.localMcp,
    }),
  );

  if (!projectApiKey) {
    const cloudUrl = host.appHost;
    store.pushStatus(`Didn't receive a project token. This shouldn't happen :(

Please let us know if you think this is a bug in the wizard:
${ISSUES_URL}`);

    store.pushStatus(`In the meantime, we'll add a dummy project token ("${DUMMY_PROJECT_API_KEY}") for you to replace later.
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

async function askForWizardLogin(options: {
  store: WizardStore;
  signup: boolean;
  email?: string;
  region?: CloudRegion;
  /** Explicit base URL override (`--base-url`); pins every PostHog origin. */
  baseUrl?: string;
  /** Used to pick the right scope set via `getOAuthScopesForProgram`.
   *  Omitted → default `WIZARD_OAUTH_SCOPES`. */
  programId?: ProgramId | null;
  scopeAdditions?: readonly string[];
  /** `--project-id`, if passed. When the user granted access to it on the consent
   *  screen we use it directly; otherwise we fall back to the first granted team. */
  projectId?: number;
  /** `--local-mcp`: forwarded into the resolved host so `host.mcpUrl` is local. */
  localMcp?: boolean;
}): Promise<ProjectData> {
  const { store } = options;
  if (options.signup) {
    return askForProvisioningSignup(
      store,
      options.email,
      options.region,
      options.baseUrl,
      options.localMcp,
      options.programId,
      options.scopeAdditions,
    );
  }

  const requestedScopes = [
    ...(options.scopeAdditions
      ? withScopeAdditions(WIZARD_OAUTH_SCOPES, options.scopeAdditions)
      : getOAuthScopesForProgram(options.programId)),
  ];
  const tokenResponse = await performOAuthFlow(
    {
      scopes: requestedScopes,
      signup: false,
      projectId: options.projectId,
      baseUrl: options.baseUrl,
    },
    store,
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
    await abortOnScreens(store, {
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
    store.pushStatus(error.message);
    await abortOnScreens(store, { message: error.message });
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
    store.pushStatus(error.message);
    await abortOnScreens(store, { message: error.message });
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

  store.pushStatus('Login complete.');
  analytics.setTag('opened-wizard-link', true);
  analytics.identifyUser(userData);

  return data;
}

async function askForProvisioningSignup(
  store: WizardStore,
  email?: string,
  region?: CloudRegion,
  baseUrl?: string,
  localMcp?: boolean,
  programId?: ProgramId | null,
  scopeAdditions?: readonly string[],
): Promise<ProjectData> {
  if (!email || !email.includes('@')) {
    store.pushStatus(
      'Email is required for signup. Use --email your@email.com with --signup.',
    );
    await abortOnScreens(store);
    throw new Error('unreachable');
  }

  store.pushStatus('Creating your PostHog account...');

  try {
    const provisionRegion = (region ?? 'us').toUpperCase() as 'US' | 'EU';
    const { orgName, projectName } = detectOrgAndProject(email);
    const result = await provisionNewAccount(email, '', provisionRegion, {
      orgName,
      projectName,
      baseUrl,
      scopes: scopeAdditions
        ? withScopeAdditions(WIZARD_PROVISIONING_SCOPES, scopeAdditions)
        : getProvisioningScopesForProgram(programId),
    });

    store.pushStatus('Account created!');
    store.pushStatus('Welcome to PostHog!');

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
      store.pushStatus(
        'Account created, but the project could not be read back.',
      );
      store.pushStatus(message);
      store.pushStatus('Signing you in to your new account instead...');

      return askForWizardLogin({ store, signup: false, baseUrl, localMcp });
    }

    store.pushStatus('Account creation failed.');

    if (message.includes('already associated')) {
      store.pushStatus(
        'This email already has a PostHog account. Switching to login flow...',
      );

      return askForWizardLogin({ store, signup: false, baseUrl, localMcp });
    }

    store.pushStatus(`Failed to create account: ${message}`);
    analytics.captureException(
      error instanceof Error ? error : new Error(message),
      { step: 'provisioning_signup' },
    );
    await abortOnScreens(store);
    throw error;
  }
}
