import { beforeEach, describe, expect, test, vi } from 'vitest';

import { buildRegistry, parseAgentPrompt } from '@agent/agent-prompt-loader';
import { Integration } from '@shared/constants';
import { featureFlagsConfig } from '@lib/programs/feature-flags/index';
import { FEATURE_FLAGS_PROMPTS } from '@lib/programs/feature-flags/prompts';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';

const bundledRegistry = () =>
  buildRegistry(
    FEATURE_FLAGS_PROMPTS.map((text) =>
      parseAgentPrompt(text, 'feature-flags', 'feature-flags'),
    ),
    'feature-flags',
  );

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('feature-flags program', () => {
  test('runs its own bundled flow with no program skill id', () => {
    expect(featureFlagsConfig.agentFlow).toBe('feature-flags');
    expect(featureFlagsConfig.agentPrompts).toBe(FEATURE_FLAGS_PROMPTS);
    expect(featureFlagsConfig.skillId).toBeUndefined();
  });

  test('detects the framework before the intro', () => {
    const stepIds = featureFlagsConfig.steps.map((step) => step.id);
    expect(stepIds.indexOf('detect')).toBeLessThan(stepIds.indexOf('intro'));
  });

  test('headless pre-run sets the skill id to the detected framework', async () => {
    vi.spyOn(
      posthogIntegrationConfig as Required<ProgramConfig>,
      'ciPreRun',
    ).mockImplementation((session: WizardSession) => {
      session.integration = Integration.nextjs;
      return Promise.resolve();
    });
    const session = {
      integration: null,
      skillId: null,
    } as unknown as WizardSession;

    await featureFlagsConfig.ciPreRun?.(session);

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
