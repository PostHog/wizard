/**
 * Polls `/integrations/` until the PostHog GitHub App shows up, writing the
 * result to the session so the Self-driving GitHub gate can advance.
 *
 * Installing the App is a manual browser step, so polling is what flips the
 * gate once the user comes back. The first tick also resolves the session's
 * unknown (`null`) state.
 */

import { useEffect } from 'react';

import type { WizardStore } from '@ui/tui/store';
import type { WizardSession } from '@lib/wizard-session';
import { fetchGithubConnected } from '@lib/api';
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

export function useGithubConnection(store: WizardStore): void {
  const credentials = store.session.credentials;
  const connected = store.session.githubConnected === true;

  useEffect(() => {
    if (!credentials || connected) return;

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
          const isConnected = await fetchGithubConnected(
            credentials.accessToken,
            credentials.projectId,
            credentials.host.apiHost,
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
  }, [credentials, connected, store]);
}
