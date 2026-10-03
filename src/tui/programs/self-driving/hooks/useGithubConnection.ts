/**
 * Polls `/integrations/` until the PostHog GitHub App shows up, writing the
 * result to the session so the Self-driving GitHub gate can advance.
 *
 * Installing the App is a manual browser step, so polling is what flips the
 * gate once the user comes back. The first tick also resolves the session's
 * unknown (`null`) state.
 *
 * The gate can open more than an hour after login, and the user can sit on it
 * for longer, so each tick reads the token through the login's OAuth session
 * rather than the one captured at auth. A stale token 401s every tick, and the
 * gate then shows "Connect GitHub" forever, even after the App lands.
 */

import { useEffect } from 'react';
import axios from 'axios';

import type { WizardStore } from '@tui/store';
import type { WizardSession } from '@programs/session/wizard-session';
import { fetchGithubConnected, type Credentials } from '@shared/api';
import { currentCredentials } from '@shared/oauth-session';
import { isGrantRevoked } from '@shared/auth-session-state';
import { requestDeepLink } from '@utils/provisioning';
import { analytics } from '@utils/analytics';

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

/** The login's current credentials, mirrored onto the session when they rotated. */
async function freshCredentials(
  store: WizardStore,
  force = false,
): Promise<Credentials | null> {
  const held = store.session.credentials;
  if (!held) return null;
  const fresh = await currentCredentials(held, force);
  if (fresh.accessToken !== held.accessToken) store.setAccessToken(fresh);
  return fresh;
}

const isUnauthorized = (err: unknown): boolean =>
  axios.isAxiosError(err) && err.response?.status === 401;

/** One check. A 401 rotates the token once and retries before it counts as a failure. */
export async function checkGithubConnected(
  store: WizardStore,
  signal: AbortSignal,
): Promise<boolean> {
  const credentials = await freshCredentials(store);
  if (!credentials) return false;
  const check = (held: Credentials): Promise<boolean> =>
    fetchGithubConnected(
      held.accessToken,
      held.projectId,
      held.host.apiHost,
      signal,
    );
  try {
    return await check(credentials);
  } catch (err) {
    if (!isUnauthorized(err) || !credentials.refreshToken || isGrantRevoked()) {
      throw err;
    }
    const rotated = await freshCredentials(store, true);
    if (!rotated || rotated.accessToken === credentials.accessToken) throw err;
    return check(rotated);
  }
}

export function useGithubConnection(store: WizardStore): void {
  // Keyed on being logged in, not on the token: a rotation mid-check must not
  // restart the loop and abort the retry it is waiting on.
  const loggedIn = store.session.credentials !== null;
  const connected = store.session.githubConnected === true;

  useEffect(() => {
    if (!loggedIn || connected) return;

    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errorReported = false;

    /** A check that came back "not connected" — including a failed one. */
    const settleUnknown = (): void => {
      if (store.session.githubConnected === null) {
        store.setGithubConnected(false);
      }
    };

    const wait = (): Promise<void> =>
      new Promise((resolve) => {
        timer = setTimeout(resolve, POLL_INTERVAL_MS);
      });

    void (async () => {
      while (!stopped) {
        try {
          const isConnected = await checkGithubConnected(
            store,
            controller.signal,
          );
          if (stopped) return;
          if (isConnected) {
            // Only a false→true flip means the user installed during this
            // screen; true on the first check means they arrived connected.
            if (store.session.githubConnected === false) {
              analytics.wizardCapture('github connect completed');
            }
            store.setGithubConnected(true);
            return;
          }
          settleUnknown();
        } catch (err) {
          if (stopped) return;
          // Report once, then keep polling. Unlike Slack's nudge, this gate
          // can't degrade to a skip — the run cannot proceed until it
          // resolves — so a transient API blip must not strand the user.
          if (!errorReported) {
            errorReported = true;
            analytics.captureException(
              err instanceof Error ? err : new Error(String(err)),
              { step: 'github_connected_check' },
            );
          }
          settleUnknown();
        }
        await wait();
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [loggedIn, connected, store]);
}
