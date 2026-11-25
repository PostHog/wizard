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
  } catch {
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
  opts?: OpenLinkOptions,
): void {
  const finalUrl = trackLinkOpen(url, content, opts);
  if (NODE_ENV !== 'test') {
    opn(finalUrl, { wait: false }).catch(() => {
      // No browser available — the printed URL is the fallback.
    });
  }
}

/** How long the opener may keep running before the open counts as made; `xdg-open` can wait on the browser. */
const BROWSER_OPEN_SETTLE_MS = 3_000;

/**
 * `openTrackedLink` for a flow that cannot go on without the browser. Resolves
 * false when the opener fails to start or exits with an error, as it does on a
 * machine with no browser or no desktop session.
 */
export async function openTrackedLinkOrFail(
  url: string,
  content: string,
  opts?: OpenLinkOptions,
): Promise<boolean> {
  const finalUrl = trackLinkOpen(url, content, opts);
  if (NODE_ENV === 'test') return true;
  try {
    const opener = await opn(finalUrl, { wait: false });
    // The opener can exit before the listeners below attach, and then 'exit' never fires for them.
    if (opener.exitCode !== null) return opener.exitCode === 0;
    return await new Promise<boolean>((resolve) => {
      const settled = setTimeout(() => resolve(true), BROWSER_OPEN_SETTLE_MS);
      settled.unref();
      opener.once('error', () => {
        clearTimeout(settled);
        resolve(false);
      });
      opener.once('exit', (code) => {
        clearTimeout(settled);
        resolve(code === 0);
      });
    });
  } catch {
    return false;
  }
}

type OpenLinkOptions = { auto?: boolean; skipUtm?: boolean };

/** UTM-tag the URL unless `skipUtm`, and capture the open. */
function trackLinkOpen(
  url: string,
  content: string,
  opts?: OpenLinkOptions,
): string {
  const finalUrl = opts?.skipUtm ? url : withUtm(url, content);
  analytics.wizardCapture('link opened', {
    content,
    url: finalUrl,
    auto: opts?.auto ?? false,
  });
  return finalUrl;
}
