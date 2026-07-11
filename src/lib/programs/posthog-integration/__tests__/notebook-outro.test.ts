/**
 * Notebook outro snapshot — the end-of-run behaviour for a one-file Node.js
 * project. After the run the integration program mirrors the setup report into
 * a PostHog notebook, auto-opens it in the browser from `postRun`, and surfaces
 * it in the outro. When there's no report to mirror, none of that happens.
 *
 * Runs fully offline: `createNotebook` (the network call) and `openTrackedLink`
 * (the browser open) are stubbed, so we assert the calls rather than real IO.
 * Update the golden with `vitest -u` after an intentional outro change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Stub the browser-open while keeping withUtm real (resolveContinueUrl uses it).
vi.mock('@utils/links', async (importActual) => {
  const actual = await importActual<typeof import('@utils/links')>();
  return { ...actual, openTrackedLink: vi.fn() };
});

// Stub the notebook API call; the converter itself is covered in notebook.test.
vi.mock('@utils/notebook', async (importActual) => {
  const actual = await importActual<typeof import('@utils/notebook')>();
  return { ...actual, createNotebook: vi.fn() };
});

import { openTrackedLink } from '@utils/links';
import { createNotebook } from '@utils/notebook';
import type { ProgramRun } from '@lib/agent/agent-runner';
import {
  buildSession,
  type WizardSession,
  type Credentials,
} from '@lib/wizard-session';
import { posthogIntegrationConfig } from '../index';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { Integration } from '@lib/constants';
import { HostResolution } from '@lib/host-resolution';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { Program } from '@lib/programs/program-registry';

const NOTEBOOK_URL = 'https://us.posthog.com/project/1/notebooks/AbC123';

const credentials: Credentials = {
  accessToken: 'phx_test',
  projectApiKey: 'phc_test',
  host: HostResolution.fromApiHost('https://us.posthog.com'),
  projectId: 1,
};

const tmpDirs: string[] = [];

// Create a minimal one-file Node.js project on disk, optionally with a report.
function makeNodeProject(opts: { report?: boolean }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-node-'));
  tmpDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'node-single-file',
      version: '1.0.0',
      main: 'index.js',
    }),
  );
  fs.writeFileSync(path.join(dir, 'index.js'), "console.log('hi');\n");
  if (opts.report) {
    fs.writeFileSync(
      path.join(dir, 'posthog-setup-report.md'),
      '# PostHog post-wizard report\n\nInstalled posthog-node.',
    );
  }
  return dir;
}

// Build a Node.js session; a UI must be set — run()/postRun() log through getUI().
function nodeSession(
  installDir: string,
  notebookUrl: string | null,
): WizardSession {
  const store = new WizardStore(Program.PostHogIntegration);
  setUI(new InkUI(store));

  const session = buildSession({ installDir, ci: true, signup: false });
  session.integration = Integration.javascriptNode;
  session.frameworkConfig = FRAMEWORK_REGISTRY[Integration.javascriptNode];
  session.notebookUrl = notebookUrl;
  return session;
}

async function programRun(session: WizardSession): Promise<ProgramRun> {
  const run = posthogIntegrationConfig.run;
  if (typeof run !== 'function') throw new Error('expected a run factory');
  return run(session);
}

describe('posthog-integration notebook outro (one-file Node.js project)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    let dir = tmpDirs.pop();
    while (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = tmpDirs.pop();
    }
  });

  it('mirrors the report into a notebook, opens it, and surfaces it in the outro', async () => {
    vi.mocked(createNotebook).mockResolvedValue(NOTEBOOK_URL);
    const session = nodeSession(makeNodeProject({ report: true }), null);
    const run = await programRun(session);

    await run.postRun?.(session, credentials);
    expect(createNotebook).toHaveBeenCalledWith(
      credentials,
      expect.stringContaining('PostHog setup (wizard)'),
      expect.stringContaining('# PostHog post-wizard report'),
    );
    expect(openTrackedLink).toHaveBeenCalledWith(NOTEBOOK_URL, 'notebook', {
      auto: true,
    });

    // postRun set the URL on the store, so the outro surfaces it.
    session.notebookUrl = NOTEBOOK_URL;
    const outro = run.buildOutroData?.(session, credentials);
    expect(outro?.notebookUrl).toBe(NOTEBOOK_URL);
    expect(outro).toMatchSnapshot();
  });

  it('opens nothing and shows no notebook link when there is no report', async () => {
    const session = nodeSession(makeNodeProject({ report: false }), null);
    const run = await programRun(session);

    await run.postRun?.(session, credentials);
    expect(createNotebook).not.toHaveBeenCalled();
    expect(openTrackedLink).not.toHaveBeenCalledWith(
      expect.anything(),
      'notebook',
      expect.anything(),
    );

    const outro = run.buildOutroData?.(session, credentials);
    expect(outro?.notebookUrl).toBeUndefined();
  });
});
