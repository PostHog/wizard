/** The browser OAuth flow: open the authorize page, wait for the callback, and exchange the code. UI-bound. */

import * as http from 'node:http';
import { logToFile } from '@utils/debug';
import type { WizardStore } from '@tui/store';
import { OAUTH_PORTS, OAUTH_TIMEOUT_MS } from '@shared/constants';
import { getOAuthUrl, resolveBaseUrl } from '@utils/urls';
import { abortOnScreens } from '@tui/abort';
import { openTrackedLink, withUtm } from '@utils/links';
import { analytics } from '@utils/analytics';
import { OAuthError, buildOAuthFailureMessage } from '@utils/oauth-errors';
import {
  getOAuthClientId,
  missingOAuthScopes,
  parseOAuthScopes,
} from '@programs';
import type { OAuthTokenResponse } from '@programs/types';
import {
  AUTHORIZATION_TIMEOUT_MESSAGE,
  exchangeCodeForToken,
  generateCodeChallenge,
  generateCodeVerifier,
  getCallbackUrl,
  getLocalLoginUrl,
  getLocalSignupUrl,
  getPortProcessInfo,
  isAuthorizationTimeout,
  isPortInUseError,
  startCallbackServer,
  type OAuthConfig,
} from './oauth.js';

/**
 * Warn — at login, while the user is still watching — when the grant came back
 * narrower than the request, and record the gap so narrowed runs are countable.
 * Non-fatal by design: deselecting an optional scope is the user's call, and
 * most flows survive it. The one scope the wizard cannot run without has its
 * own hard check (`assertWizardCompletionScope`).
 */
function reportNarrowedGrant(
  requestedScopes: readonly string[],
  grantedScope: string,
  store: WizardStore,
): void {
  const missing = missingOAuthScopes(requestedScopes, grantedScope);
  if (missing.length === 0) return;

  logToFile(
    `[oauth] grant narrower than request, missing: ${missing.join(' ')}`,
  );
  analytics.wizardCapture('oauth grant narrowed', {
    requested_scopes: [...requestedScopes].sort().join(' '),
    granted_scopes: parseOAuthScopes(grantedScope).sort().join(' '),
    missing_scopes: missing.join(' '),
    missing_scope_count: missing.length,
  });
  const plural = missing.length > 1;
  store.pushStatus(
    `Your PostHog authorization is missing ${
      plural ? `${missing.length} permissions` : 'a permission'
    } the wizard asked for: ${missing.join(', ')}. ` +
      `Setup will continue, but steps that need ${
        plural ? 'them' : 'it'
      } may fail. ` +
      `To grant ${
        plural ? 'them' : 'it'
      }, re-run the wizard and approve all permissions on the ` +
      'authorization screen. If that screen does not reappear, revoke the ' +
      'existing PostHog Wizard authorization in your PostHog settings first.',
  );
}

export async function performOAuthFlow(
  config: OAuthConfig,
  store: WizardStore,
): Promise<OAuthTokenResponse> {
  const clientId = getOAuthClientId(config.baseUrl);
  const oauthUrl = getOAuthUrl(config.baseUrl);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  let shouldRetry = false;

  logToFile(
    `[oauth] starting flow against ${oauthUrl}, ` +
      `requested scopes: ${config.scopes.join(' ')}`,
  );

  do {
    shouldRetry = false;
    let lastProcessInfo: {
      command: string;
      pid: string;
      port: number;
      user: string;
    } | null = null;

    for (const port of OAUTH_PORTS) {
      const callbackUrl = getCallbackUrl(port);
      const authUrl = new URL(`${oauthUrl}/oauth/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', callbackUrl);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('scope', config.scopes.join(' '));
      authUrl.searchParams.set('required_access_level', 'project');
      if (config.projectId !== undefined) {
        // Pre-select this project on the consent screen so the user just clicks Authorize.
        authUrl.searchParams.set('team_id', String(config.projectId));
      }

      // UTM-tag both kickoff URLs so the journey into the app is
      // attributable to the wizard command that started it.
      const taggedAuthUrl = withUtm(authUrl.toString(), 'oauth-authorize');
      const signupUrl = new URL(
        withUtm(
          `${oauthUrl}/signup?next=${encodeURIComponent(taggedAuthUrl)}`,
          'oauth-signup',
        ),
      );
      const localSignupUrl = getLocalSignupUrl(port);
      const localLoginUrl = getLocalLoginUrl(port);
      const urlToOpen = config.signup ? localSignupUrl : localLoginUrl;

      logToFile(`[oauth] attempting callback server on port ${port}`);

      let server: http.Server;
      let waitForCallback: () => Promise<string>;
      try {
        ({ server, waitForCallback } = await startCallbackServer(
          taggedAuthUrl,
          signupUrl.toString(),
          port,
        ));
      } catch (e) {
        if (!isPortInUseError(e)) throw e;
        lastProcessInfo = getPortProcessInfo(port);
        continue;
      }

      logToFile('[oauth] callback server ready, showing login URL');

      store.setLoginUrl(urlToOpen);
      // The localhost proxy above only works on this machine. Surface the
      // direct PostHog authorize URL too, for the manual-paste modal — on a
      // remote/headless box the user opens it from another machine, where
      // localhost:<port> is unreachable.
      store.setAuthorizeUrl(
        config.signup ? signupUrl.toString() : taggedAuthUrl,
      );

      // The localhost proxy URL stays untagged — the PostHog destination
      // it redirects to carries the UTMs.
      openTrackedLink(urlToOpen, 'oauth', { auto: true, skipUtm: true });

      store.pushStatus('Waiting for authorization...');

      try {
        // Race the local callback server against a manually-pasted code. The
        // manual path is the fallback for headless/remote shells where the
        // browser can't reach localhost — the user opens the auth screen's
        // paste modal and submits the callback URL or code by hand.
        const code = await Promise.race([
          waitForCallback(),
          store.waitForManualAuthCode(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(AUTHORIZATION_TIMEOUT_MESSAGE)),
              OAUTH_TIMEOUT_MS,
            ),
          ),
        ]);

        const token = await exchangeCodeForToken(
          code,
          codeVerifier,
          callbackUrl,
          config.baseUrl,
        );

        server.close();
        store.setLoginUrl(null);
        store.setAuthorizeUrl(null);
        store.pushStatus('Authorization complete!');

        reportNarrowedGrant(config.scopes, token.scope, store);

        return token;
      } catch (e) {
        const error = e instanceof Error ? e : new Error('Unknown error');
        const timedOut = isAuthorizationTimeout(error);
        const flowError = error instanceof OAuthError ? error : null;

        store.pushStatus(
          timedOut ? 'Session timed out.' : 'Authorization failed.',
        );
        server.close();

        logToFile('[oauth] flow failed:', error);
        if (flowError?.description) {
          logToFile(
            `[oauth] server error_description: ${flowError.description}`,
          );
        }

        const accessDenied = flowError
          ? flowError.code === 'access_denied'
          : error.message.includes('access_denied');

        if (timedOut) {
          // Overlay bypasses the auth-step gating (which never completes
          // without credentials), so the user sees the failure instead of a
          // spinner that never stops; any key exits.
          store.showSessionTimeout();
        } else if (accessDenied) {
          store.pushStatus(
            `Authorization was cancelled.\n\nYou denied access to PostHog. To use the wizard, you need to authorize access to your PostHog account.\n\nYou can try again by re-running the wizard.`,
          );
        } else {
          store.pushStatus(
            buildOAuthFailureMessage({
              error,
              requestedScopes: config.scopes,
              clientId,
              oauthUrl,
              // Same condition that selects the dev client ID: a resolvable
              // base URL means a dev-seeded stack, where "fix your local
              // OAuth app" beats pointing at the production runbook.
              isDevStack: resolveBaseUrl(config.baseUrl) !== undefined,
            }),
          );
        }

        const oauthErrorCode = flowError
          ? flowError.code
          : error.message.startsWith('OAuth error: ')
          ? error.message.slice('OAuth error: '.length)
          : timedOut
          ? 'timeout'
          : 'unknown';

        analytics.captureException(error, {
          step: 'oauth_flow',
          oauth_error_code: oauthErrorCode,
          oauth_error_description: flowError?.description,
          client_id: clientId,
          requested_scopes: config.scopes.join(' '),
          // Collapse OAuth callback failures of the same kind into one issue
          // instead of fragmenting by each user's install path in the stack trace.
          $exception_fingerprint: `wizard_oauth_${oauthErrorCode}`,
        });

        await abortOnScreens(store);
        throw error;
      }
    }

    if (!lastProcessInfo) {
      throw new Error('No OAuth callback ports configured');
    }

    await store.showPortConflict(lastProcessInfo);
    shouldRetry = true;
  } while (shouldRetry);

  throw new Error('OAuth port retry loop exited unexpectedly');
}
