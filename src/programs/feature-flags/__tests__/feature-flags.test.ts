import { beforeEach, describe, expect, test, vi } from 'vitest';

import { buildRegistry, parseAgentPrompt } from '@agent/agent-prompt-loader';
import { Integration } from '@shared/constants';
import { detectFramework } from '@programs/detection/framework';
import { gatherFrameworkContext } from '@programs/detection/context';
import { getOAuthScopesForProgram } from '@programs/program-registry';
import { config as featureFlagsConfig } from '@programs/feature-flags';
import { FEATURE_FLAGS_PROMPTS } from '@programs/feature-flags/prompts';
import type { WizardSession } from '@programs/session/wizard-session';
import { testCiRunnerContext } from '@programs/shared/__tests__/runner-context.no-jest';
import { analytics } from '@utils/analytics';

vi.mock(import('@programs/detection/framework'), async (importOriginal) => ({
  ...(await importOriginal()),
  detectFramework: vi.fn(),
}));
vi.mock(import('@programs/detection/context'), async (importOriginal) => ({
  ...(await importOriginal()),
  gatherFrameworkContext: vi.fn(),
}));
vi.mock('@programs/detection/project-scope', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@programs/detection/project-scope')
  >()),
  scopeInstallDirToProject: vi.fn(),
}));

const bundledRegistry = () =>
  buildRegistry(
    FEATURE_FLAGS_PROMPTS.map((text) =>
      parseAgentPrompt(text, 'feature-flags', 'feature-flags'),
    ),
    'feature-flags',
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(analytics, 'setTag').mockImplementation(() => undefined);
});

describe('feature-flags program', () => {
  test('runs its own bundled flow with no program skill id', () => {
    expect(featureFlagsConfig.agentFlow).toBe('feature-flags');
    expect(featureFlagsConfig.agentPrompts).toBe(FEATURE_FLAGS_PROMPTS);
    expect(featureFlagsConfig.skillId).toBeUndefined();
  });

  test('detects the framework before the intro', () => {
    expect(featureFlagsConfig.onReady).toBeDefined();
  });

  test('requests both feature flag scopes', () => {
    const scopes = getOAuthScopesForProgram('feature-flags');
    expect(scopes).toContain('feature_flag:read');
    expect(scopes).toContain('feature_flag:write');
  });

  test('headless pre-run sets the skill id to the detected framework', async () => {
    vi.mocked(detectFramework).mockResolvedValue(Integration.nextjs);
    vi.mocked(gatherFrameworkContext).mockResolvedValue({});
    const session = {
      installDir: '/tmp/feature-flags-ci',
      frameworkContext: {},
      integration: null,
      skillId: null,
    } as unknown as WizardSession;

    await featureFlagsConfig.ciPreRun?.(session, testCiRunnerContext());

    expect(session.integration).toBe(Integration.nextjs);
    expect(session.skillId).toBe(Integration.nextjs);
  });
});

describe('feature-flags bundled prompts', () => {
  test('have one seed and end in the report sink', () => {
    const registry = bundledRegistry();
    expect(registry.seed?.type).toBe('setup-feature-flags');
    expect(registry.types).toEqual([
      'install',
      'init',
      'create-flag',
      'evaluate',
      'report',
    ]);
    expect(registry.sinkTypes).toEqual(['report']);
  });

  test('evaluate the flag with the context-mill step skill', () => {
    expect(bundledRegistry().get('evaluate')?.skills).toEqual([
      'integration-v2-feature-flags-step',
    ]);
  });

  test('pin pi models only', () => {
    const registry = bundledRegistry();
    for (const prompt of [
      registry.seed,
      ...registry.types.map((type) => registry.get(type)),
    ]) {
      expect(prompt?.modelPi).toMatch(/^openai\/gpt-5\.6-/);
      expect(prompt?.effortPi).toBeDefined();
      expect(prompt?.modelSdk).toBeUndefined();
    }
  });
});
