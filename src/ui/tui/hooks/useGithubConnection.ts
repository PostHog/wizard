/**
 * Polls `/integrations/` until the PostHog GitHub App shows up, writing the
 * result to the session so the Self-driving GitHub gate can advance.
 *
 * Installing the App is a manual browser step, so polling is what flips the
 * gate once the user comes back. The first tick also resolves the session's
 * unknown (`null`) state.
 *
 * A rejected token is the one failure the poll must not absorb. The gate is not
 * skippable, so a 401 answered with "not connected" reads to the user as an App
 * that never installs, and the only way out is to decline — which ends the run.
 * So the token is refreshed before the first tick and once more when the server
 * rejects it, and a login that stays rejected raises the auth-error screen.
 */

import { useEffect, useRef } from 'react';

import type { WizardStore } from '@ui/tui/store';
import type { WizardSession } from '@lib/wizard-session';
import { ApiError, fetchGithubConnected } from '@lib/api';
import { refreshAccessTokenIfNeeded } from '@lib/session-token';
import { requestDeepLink } from '@utils/provisioning';
import { analytics } from '@utils/analytics';
import { getLogFilePath } from '@utils/debug';

const POLL_INTERVAL_MS = 3000;

// Provisioned signups have no browser session for the install link; deep link when the partner tier grants one, else the login page.
export async function fetchLoginUrl(
  session: WizardSession,
): Promise<string | null> {
  if (!session.signup || !session.credentials) return null;
  const deepLink = await requestDeepLink(
    session.credentials.accessToken,
    session.credentials.host,
  );
  return deepLink ?? `${session.credentials.host.appHost}/login`;
}

/**
 * Carried across polls because the screen can remount while the same login
 * stays dead. Kept in one object, or a stale token would buy an unlimited
 * number of refreshes and never reach the give-up path.
 */
export interface GithubPollState {
  refreshAttempted: boolean;
  sawAuthFailure: boolean;
  errorReported: boolean;
}

const isAuthFailure = (error: unknown): boolean =>
  error instanceof ApiError && error.statusCode === 401;

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });

export async function pollGithubConnection(
  store: WizardStore,
  state: GithubPollState,
  signal: AbortSignal,
  pollIntervalMs: number,
): Promise<void> {
  /** A check that came back "not connected" — including a failed one. */
  const settleUnknown = (): void => {
    if (store.session.githubConnected === null) {
      store.setGithubConnected(false);
    }
  };

  // Nothing refreshes the token before this screen — the agent bootstrap does,
  // and it runs after the gate — so a token that aged out during the earlier
  // integration phase would be rejected on every tick from here on.
  if (await refreshAccessTokenIfNeeded(store.session)) {
    state.refreshAttempted = true;
  }

  while (!signal.aborted) {
    // Read the credentials per tick: a refresh replaces them mid-poll.
    const credentials = store.session.credentials;
    if (!credentials) return;

    try {
      const isConnected = await fetchGithubConnected(
        credentials.accessToken,
        credentials.projectId,
        credentials.host.apiHost,
        signal,
      );
      if (signal.aborted) return;
      if (isConnected) {
        // Only a false→true flip means the user installed during this screen;
        // true on the first check means they arrived connected.
        if (store.session.githubConnected === false) {
          analytics.wizardCapture('github connect completed');
        }
        store.setGithubConnected(true);
        return;
      }
      settleUnknown();
    } catch (err) {
      if (signal.aborted) return;
      // Report once, then keep polling. Unlike Slack's nudge, this gate can't
      // degrade to a skip — the run cannot proceed until it resolves — so a
      // transient API blip must not strand the user.
      if (!state.errorReported) {
        state.errorReported = true;
        analytics.captureException(
          err instanceof Error ? err : new Error(String(err)),
          { step: 'github_connected_check' },
        );
      }
      if (isAuthFailure(err)) {
        // One forced refresh: the server rejected the token, so its stated
        // expiry says nothing and the usual lifetime check would skip it.
        if (!state.refreshAttempted) {
          state.refreshAttempted = true;
          const swapped = await refreshAccessTokenIfNeeded(store.session, {
            force: true,
          });
          if (swapped) continue;
        }
        if (state.sawAuthFailure) {
          // A second rejection after a fresh token: the login itself is gone.
          // Name it, rather than leaving a gate the user can only answer by
          // ending their run.
          analytics.wizardCapture('github connect auth failed');
          store.showAuthError({
            hasSettingsConflict: false,
            sessionExpired: true,
            logFilePath: getLogFilePath(),
          });
          return;
        }
        state.sawAuthFailure = true;
      }
      settleUnknown();
    }
    await sleep(pollIntervalMs, signal);
  }
}

export function useGithubConnection(store: WizardStore): void {
  // Presence, not identity: a refresh replaces `credentials`, and the poll
  // already re-reads them per tick, so restarting on the swap only duplicates
  // the in-flight request.
  const hasCredentials = store.session.credentials !== null;
  const connected = store.session.githubConnected === true;
  const state = useRef<GithubPollState>({
    refreshAttempted: false,
    sawAuthFailure: false,
    errorReported: false,
  });

  useEffect(() => {
    if (!hasCredentials || connected) return;

    const controller = new AbortController();
    void pollGithubConnection(
      store,
      state.current,
      controller.signal,
      POLL_INTERVAL_MS,
    );

    return () => controller.abort();
  }, [hasCredentials, connected, store]);
}
