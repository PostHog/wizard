/**
 * Outbound links: UTM tagging and tracked opens.
 *
 * Every URL the wizard sends a user to — auto-opened or printed in the TUI —
 * carries `utm_source=wizard`, `utm_medium=cli`, `utm_content=<which link>`.
 * The command dimension rides on every wizard event as the `command` tag.
 * Opening a link also captures a wizard event.
 */
import opn from 'opn';
import { NODE_ENV } from '@env';
import { analytics } from './analytics';

/**
 * Record the CLI command this run was started with (e.g. `integrate`,
 * `slack`, `mcp-add`). Set once at dispatch; tagged onto every wizard
 * event so wizard-side events segment by command.
 */
export function setEntryCommand(command: string): void {
  analytics.setTag('command', command);
}

/**
 * Tag a URL with the wizard's UTM params. `content` names the specific link
 * (e.g. `oauth-signup`, `slack-connect-setup`). URLs that already carry a
 * utm_source — or don't parse — are returned untouched.
 */
export function withUtm(url: string, content: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    analytics.captureException(
      err instanceof Error ? err : new Error(String(err)),
      { step: 'with_utm' },
    );
    return url;
  }
  if (parsed.searchParams.has('utm_source')) return url;
  parsed.searchParams.set('utm_source', 'wizard');
  parsed.searchParams.set('utm_medium', 'cli');
  parsed.searchParams.set('utm_content', content);
  return parsed.toString();
}

/**
 * Open a URL in the user's browser, UTM-tagged (pass `skipUtm` for
 * destinations that aren't PostHog properties or are already final), and
 * capture the interaction. `auto` marks opens the wizard initiated itself,
 * as opposed to a user picking a link on screen. opn throws in headless
 * environments — the URL is always also printed on screen, so the failure
 * is swallowed.
 */
export function openTrackedLink(
  url: string,
  content: string,
  opts?: { auto?: boolean; skipUtm?: boolean },
): void {
  const finalUrl = opts?.skipUtm ? url : withUtm(url, content);
  analytics.wizardCapture('link opened', {
    content,
    url: finalUrl,
    auto: opts?.auto ?? false,
  });
  if (NODE_ENV !== 'test') {
    opn(finalUrl, { wait: false }).catch(() => {
      // No browser available — the printed URL is the fallback.
    });
  }
}
