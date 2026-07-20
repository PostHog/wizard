/**
 * The default flow's outro — "Successfully installed PostHog!" plus the change
 * list, docs link, and coding-agent handoff prompt.
 *
 * Its own module (rather than a closure inside `posthogIntegrationConfig.run`)
 * so the composed warehouse run can reuse it without a circular import between
 * `index.ts`, `steps.ts`, and `warehouse-step.ts`.
 */

import type { Credentials } from '@lib/agent/agent-runner';
import type { WizardSession, OutroData } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import type { HostResolution } from '@lib/host-resolution';
import { withUtm } from '@utils/links';
import { buildCodingAgentPrompt } from './handoff.js';

export const SETUP_REPORT_FILE = 'posthog-setup-report.md';

/** frameworkContext key holding the signup dashboard deep link, set by postRun. */
export const DASHBOARD_DEEP_LINK_KEY = 'dashboardDeepLink';

function resolveContinueUrl(
  sess: WizardSession,
  host: HostResolution,
  deepLink: unknown,
): string | undefined {
  if (!sess.signup) return undefined;
  if (typeof deepLink === 'string' && deepLink) return deepLink;
  return withUtm(`${host.appHost}/products?source=wizard`, 'outro-continue');
}

/**
 * Build the integration outro.
 *
 * `extraChanges` exists for the composed warehouse run. The last agent run of
 * an invocation owns the outro (`runner/sequence/linear.ts`), so when the user
 * opts into warehouse setup that run ends the wizard — but the headline should
 * still be the PostHog install, with what the warehouse run connected appended
 * to the same change list.
 */
export function buildIntegrationOutroData(
  sess: WizardSession,
  credentials: Credentials,
  extraChanges: string[] = [],
): OutroData {
  const config = sess.frameworkConfig!;
  const frameworkContext = sess.frameworkContext;
  const envVars = config.environment.getEnvVars(
    credentials.projectApiKey,
    credentials.host.apiHost,
  );
  const deepLink = frameworkContext[DASHBOARD_DEEP_LINK_KEY];
  const continueUrl = resolveContinueUrl(sess, credentials.host, deepLink);

  const changes = [
    ...config.ui.getOutroChanges(frameworkContext),
    Object.keys(envVars).length > 0
      ? 'Added environment variables to .env file'
      : '',
    ...extraChanges,
  ].filter(Boolean);

  return {
    kind: OutroKind.Success as const,
    message: 'Successfully installed PostHog!',
    reportFile: SETUP_REPORT_FILE,
    changes,
    docsUrl: config.metadata.docsUrl,
    continueUrl,
    // Set once the agent mirrors the report into a notebook and emits [NOTEBOOK_URL].
    notebookUrl: sess.notebookUrl ?? undefined,
    handoffPrompt: buildCodingAgentPrompt(SETUP_REPORT_FILE),
  };
}
