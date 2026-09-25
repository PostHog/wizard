import { describe, it, expect } from 'vitest';
import { skillPreflightFailure } from '../orchestrator-runner';
import { ErrorCodes } from '@shared/errors';

const MISSING = ['install/integration-v2-install', 'init/integration-v2-init'];

describe('skillPreflightFailure', () => {
  it('reports no detected framework as a detection failure', () => {
    const failure = skillPreflightFailure({
      missing: MISSING,
      framework: undefined,
      menuAvailable: true,
      frameworkDocsUrl: undefined,
    });

    expect(failure.code).toBe(ErrorCodes.DetectNoFramework);
    expect(failure.message).toContain('Could not auto-detect your framework');
    expect(failure.message).not.toContain('failed to download');
  });

  it('reports an empty menu as a download failure the user can retry', () => {
    const failure = skillPreflightFailure({
      missing: MISSING,
      framework: 'kmp',
      menuAvailable: false,
      frameworkDocsUrl: 'https://posthog.com/docs/libraries/kmp',
    });

    expect(failure.code).toBe(ErrorCodes.SkillMenuFetchFailed);
    expect(failure.message).toContain('failed to download');
    expect(failure.message).toContain('Please try again');
  });

  it('names the framework when the menu carries no variant for it', () => {
    const failure = skillPreflightFailure({
      missing: MISSING,
      framework: 'kmp',
      menuAvailable: true,
      frameworkDocsUrl: 'https://posthog.com/docs/libraries/kmp',
    });

    expect(failure.code).toBe(ErrorCodes.AgentOrchestratorSkillVariantMissing);
    expect(failure.message).toContain('no setup instructions for kmp');
    expect(failure.message).toContain('https://posthog.com/docs/libraries/kmp');
    expect(failure.message).not.toContain('failed to download');
    expect(failure.message).not.toContain('try again');
  });

  it('never names a key the framework registry does not know', () => {
    const failure = skillPreflightFailure({
      missing: MISSING,
      framework: 'replay-vision-setup',
      menuAvailable: true,
      frameworkDocsUrl: undefined,
    });

    expect(failure.code).toBe(ErrorCodes.AgentOrchestratorSkillVariantMissing);
    expect(failure.message).toContain('no setup instructions for this project');
    expect(failure.message).not.toContain('replay-vision-setup');
    expect(failure.message).toContain('https://posthog.com/docs');
  });
});
