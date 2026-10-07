/** What a run does with the label a framework gives its gathered context (Django with Wagtail CMS, Next.js App Router). */
import type { FrameworkConfig } from '../framework-config';
import type { ProgramSession } from '../program-session';
import { analytics } from '@utils/analytics';

/** A CI run prints the label, a TUI run keeps it on its session and the `detected_framework` tag. */
export function noteDetectedFramework(
  session: ProgramSession,
  config: FrameworkConfig,
  context: Record<string, unknown>,
  log: { info(message: string): void },
): void {
  const label = config.metadata.getDetectedFrameworkLabel?.(context);
  if (!label) return;
  if (session.ci) {
    log.info(`Framework: ${label}`);
    return;
  }
  session.detectedFrameworkLabel = label;
  analytics.setTag('detected_framework', label);
}
