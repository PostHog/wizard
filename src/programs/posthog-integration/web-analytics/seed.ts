import type { ProgramConfig, ProgramSession } from '@programs/program-contract';
import { shouldDisableAsk } from '@shared/ask-policy';
import { getProject } from '@services/project-discovery';
import {
  describeCandidate,
  scanConversionCandidates,
  type ConversionScan,
} from './conversion-candidates.js';

/** Task type of the seeded web analytics step, as `agent/web-analytics.md` declares it. */
export const WEB_ANALYTICS_TASK_TYPE = 'web-analytics';

/** Launch flag: the step runs only where it reads 'true', so a failed flag fetch leaves it out. */
export const WIZARD_WEB_ANALYTICS_SETUP_FLAG_KEY = 'wizard-web-analytics-setup';

const WEB_ANALYTICS_DOCS_URL = 'https://posthog.com/docs/web-analytics';

type SeedTask = ReturnType<NonNullable<ProgramConfig['seedTasks']>>[number];

const scans = new WeakMap<ProgramSession, ConversionScan>();

/** One scan per session: the facts and the seed both read it. */
export function conversionScan(sess: ProgramSession): ConversionScan {
  const cached = scans.get(sess);
  if (cached) return cached;
  const scan = scanConversionCandidates(sess.installDir);
  scans.set(sess, scan);
  return scan;
}

function servesWebUi(sess: ProgramSession): boolean {
  return getProject(sess).traits.webFrontend === 'yes';
}

/** Excludes the step unless its launch flag is on. */
export function webAnalyticsExcludedTypes(
  flags: Record<string, string>,
): string[] {
  return flags[WIZARD_WEB_ANALYTICS_SETUP_FLAG_KEY] === 'true'
    ? []
    : [WEB_ANALYTICS_TASK_TYPE];
}

/**
 * Tells the capture task which conversion the scan found, so the event the
 * goal needs exists by the time the web-analytics step asks about it.
 */
export function webAnalyticsFacts(
  flags: Record<string, string>,
  sess: ProgramSession,
): string[] {
  if (webAnalyticsExcludedTypes(flags).length > 0) return [];
  if (!servesWebUi(sess) || shouldDisableAsk(sess)) return [];
  const [top] = conversionScan(sess).candidates;
  if (!top) return [];
  return [
    `Most likely conversion from the wizard's scan: ${describeCandidate(
      top,
    )}. The capture task makes sure this action has a capture call that fires on success, and names it in its handoff; the web-analytics task turns it into a conversion goal.`,
  ];
}

/**
 * The step that finishes web analytics once the code is in: confirms the
 * conversion goal with the user and creates it, adds the site's domain to the
 * authorized URLs, and checks pageview capture.
 *
 * Seeded for a project that serves a web UI, in a run where someone can answer
 * `wizard_ask`, since every change it makes in PostHog is confirmed first. The
 * launch flag removes the type from the run, and the runner then drops this seed.
 */
export function webAnalyticsSeedTasks(sess: ProgramSession): SeedTask[] {
  if (!servesWebUi(sess) || shouldDisableAsk(sess)) return [];
  const scan = conversionScan(sess);

  return [
    {
      type: WEB_ANALYTICS_TASK_TYPE,
      inputs: {
        conversionCandidates: scan.candidates.map((c) => ({
          kind: c.kind,
          label: c.label,
          files: c.files,
          route: c.route,
          posthogEvent: c.posthogEvent,
          signals: c.signals,
        })),
        successRoutes: scan.successRoutes,
      },
      notice: {
        title: 'Set up web analytics',
        body: [
          "After the code changes, we finish web analytics: we check that pageviews are captured on every route, add your site to the project's authorized URLs, and create a conversion goal.",
          scan.candidates.length > 0
            ? "We'll ask you to confirm the goal before we create anything. These look like conversions in your code:"
            : "We didn't find a sign-up, checkout or contact flow, so we'll ask you which page or event counts as a conversion.",
          "You can select [Skip] if you'd like to do this later in PostHog.",
        ],
        items: scan.candidates.map((c) => c.label),
        docsLabel: 'Learn more about web analytics',
        docsUrl: WEB_ANALYTICS_DOCS_URL,
        prompt: 'Set up web analytics during this run?',
        confirmLabel: 'Continue [Enter]',
        cancelLabel: 'Skip [Esc]',
      },
    },
  ];
}
