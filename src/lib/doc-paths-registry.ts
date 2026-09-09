import * as path from 'node:path';

/**
 * Registry of wizard-documentation paths.
 *
 * Files the wizard's own programs write to describe events the user's
 * codebase already captures, or events a program is proposing to add. When
 * the agent copies a literal `posthog.capture('event', { email: ... })`
 * snippet (or a property list including PII-shaped keys) into one of these
 * files, the `pii_in_capture_call` rule (category: posthog_pii) fires even
 * though the wizard is documenting / planning, not introducing, the
 * pattern. The scanning hooks suppress posthog_pii matches on these paths
 * only; every other rule (secrets, prompt injection, supply chain,
 * destructive ops) still fires normally so the file cannot be used as a
 * smuggling vector for actual violations.
 *
 * This module is deliberately product-blind (wizard#594): it knows nothing
 * about which programs exist. Each program declares the doc files it writes
 * via `ProgramConfig.docPaths`; the program registry pushes every
 * declaration in here as a module side effect. L2 scanning infra
 * (yara-hooks, the pi security extension) only ever reads the answer.
 */

/** Exact basenames (e.g. `.posthog-events.json`). */
const docBasenames = new Set<string>();
/** Basename patterns (e.g. per-part inventory files). */
const docPatterns: RegExp[] = [];

/**
 * Declare documentation paths. Entries are basenames (matched exactly) or
 * RegExps (tested against the basename). Duplicate registrations are
 * harmless; `undefined` is a no-op so call sites can pass
 * `config.docPaths` straight through.
 */
export function registerWizardDocPaths(
  entries: ReadonlyArray<string | RegExp> | undefined,
): void {
  for (const entry of entries ?? []) {
    if (typeof entry === 'string') {
      docBasenames.add(entry);
    } else if (!docPatterns.some((re) => re.source === entry.source)) {
      docPatterns.push(entry);
    }
  }
}

/** True when `filePath`'s basename was declared as wizard documentation. */
export function isWizardDocumentationPath(
  filePath: string | undefined,
): boolean {
  if (!filePath) return false;
  const basename = path.basename(filePath);
  if (docBasenames.has(basename)) return true;
  return docPatterns.some((re) => re.test(basename));
}

/** Test-only: clear all registrations. */
export function resetWizardDocPathsForTests(): void {
  docBasenames.clear();
  docPatterns.length = 0;
}
