/**
 * Post-audit setup-review upload — the local counterpart of the cloud wizard
 * setup review (posthog: run_wizard_audit activity → merge webhook →
 * WizardSetupReviewWorkflow). POSTs the audit's check ledger so the server
 * can turn failing checks into complimentary PRs in the inbox. Best-effort:
 * fail-silent everywhere, the server owns all policy (one review per team,
 * consent, billing exemption).
 *
 * Skipped when `session.ci` is set: cloud/headless runs capture the ledger
 * themselves and wait for the PR merge — uploading from the sandbox would
 * fire the review before the integration exists on the default branch.
 */

import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Credentials, WizardSession } from '@lib/wizard-session';
import { debug } from '@utils/debug';
import { AUDIT_CHECKS_FILE, coerceAuditChecks } from './types.js';

/** Server-side cap mirrored here so an oversized ledger never 400s the upload. */
export const MAX_UPLOAD_CHECKS = 50;

/**
 * Resolve the project's `owner/repo` from its `origin` remote. Null means
 * there is no repo the review could ship a PR to, and the upload is skipped.
 */
export function parseRepositoryFromGitRemote(
  installDir: string,
): string | null {
  try {
    const url = childProcess
      .execSync('git remote get-url origin', {
        cwd: installDir,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString()
      .trim();
    // git@github.com:acme/my-app.git or https://github.com/acme/my-app.git
    const match = url.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    // not a git repo, or no origin remote
  }
  return null;
}

/** The audit program's `postRun` — fires only after a successful run. Never throws. */
export async function uploadSetupReview(
  session: WizardSession,
  credentials: Credentials,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<void> {
  try {
    if (session.ci) return;

    const repository = parseRepositoryFromGitRemote(session.installDir);
    if (!repository) {
      debug('[setup-review] no origin remote, skipping upload');
      return;
    }

    const ledgerPath = path.join(session.installDir, AUDIT_CHECKS_FILE);
    let checks;
    try {
      checks = coerceAuditChecks(
        JSON.parse(fs.readFileSync(ledgerPath, 'utf8')),
      );
    } catch {
      debug('[setup-review] no readable check ledger, skipping upload');
      return;
    }
    if (checks.length === 0) return;

    const url = `${credentials.host.apiHost.replace(/\/$/, '')}/api/projects/${
      credentials.projectId
    }/wizard/sessions/setup_review/`;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.accessToken}`,
      },
      body: JSON.stringify({
        repository,
        checks: checks.slice(0, MAX_UPLOAD_CHECKS),
      }),
    });
    debug(`[setup-review] upload status ${response.status}`);
  } catch (err) {
    debug('[setup-review] upload failed', err);
  }
}
