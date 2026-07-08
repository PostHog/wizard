import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { removeProgramArtifacts } from '@lib/agent/runner/shared/artifacts';
import { buildSession } from '@lib/wizard-session';
import type { ProgramConfig } from '@lib/programs/program-step';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import { EVENT_PLAN_FILE } from '@lib/programs/posthog-integration/constants';

function makeConfig(cleanupArtifacts?: readonly string[]): ProgramConfig {
  return {
    description: 'test program',
    id: 'test-program',
    steps: [],
    cleanupArtifacts,
  };
}

describe('removeProgramArtifacts', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-artifacts-'));
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  it('removes a declared artifact left behind by the run', () => {
    const planFile = path.join(installDir, EVENT_PLAN_FILE);
    fs.writeFileSync(planFile, JSON.stringify({ events: [] }));

    removeProgramArtifacts(
      buildSession({ installDir }),
      makeConfig([EVENT_PLAN_FILE]),
    );

    expect(fs.existsSync(planFile)).toBe(false);
  });

  it('is a no-op when the artifact does not exist', () => {
    expect(() =>
      removeProgramArtifacts(
        buildSession({ installDir }),
        makeConfig([EVENT_PLAN_FILE]),
      ),
    ).not.toThrow();
  });

  it('is a no-op when the program declares no artifacts', () => {
    const bystander = path.join(installDir, 'index.js');
    fs.writeFileSync(bystander, 'console.log("hi")');

    removeProgramArtifacts(buildSession({ installDir }), makeConfig());

    expect(fs.existsSync(bystander)).toBe(true);
  });

  it('refuses paths that escape the install dir', () => {
    const outside = path.join(os.tmpdir(), `wizard-outside-${process.pid}`);
    fs.writeFileSync(outside, 'do not touch');
    try {
      removeProgramArtifacts(
        buildSession({ installDir }),
        makeConfig([path.relative(installDir, outside)]),
      );
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('never targets the install dir itself', () => {
    removeProgramArtifacts(buildSession({ installDir }), makeConfig(['.']));
    expect(fs.existsSync(installDir)).toBe(true);
  });
});

// Contract: the basic-integration program owns the event-plan file, so its
// config must declare it for host-side cleanup. Skills tell the agent to skip
// the delete step (commandments) — this declaration is what actually removes
// the file after the run.
describe('posthog-integration cleanupArtifacts contract', () => {
  it('declares the event plan file', () => {
    expect(posthogIntegrationConfig.cleanupArtifacts).toContain(
      EVENT_PLAN_FILE,
    );
  });
});
