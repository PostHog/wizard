import { PROGRAM_REGISTRY } from '../program-registry';
import {
  RUNTIME_PROGRAM_REGISTRY,
  getRuntimeProgramConfig,
} from '../runtime-registry';
import { HostResolution } from '@shared/posthog/host-resolution';

const promptContext = {
  projectId: 42,
  projectApiKey: 'phc-test',
  host: HostResolution.fromApiHost('https://us.posthog.com'),
};

it('exposes every registered program and its callable agent policy', () => {
  expect(RUNTIME_PROGRAM_REGISTRY.map((config) => config.id)).toEqual(
    PROGRAM_REGISTRY.map((config) => config.id),
  );

  for (const legacy of PROGRAM_REGISTRY) {
    const runtime = getRuntimeProgramConfig(legacy.id);
    expect(runtime).toMatchObject({ id: legacy.id });
    expect(runtime?.agentFlow).toBe(legacy.agentFlow);
    expect(runtime?.requiresAi).toBe(legacy.requiresAi);
    expect(runtime?.allowedTools).toEqual(legacy.allowedTools);
    expect(runtime?.disallowedTools).toEqual(legacy.disallowedTools);
    const legacyRun = typeof legacy.run === 'object' ? legacy.run : undefined;
    if (!legacyRun || !runtime?.run) {
      expect(runtime?.run).toBe(legacyRun);
      continue;
    }
    expect({
      ...runtime.run,
      customPrompt: runtime.run.customPrompt?.(promptContext),
    }).toEqual({
      ...legacyRun,
      customPrompt: legacyRun.customPrompt?.(promptContext),
    });
  }
});

it('returns no config for an unknown program', () => {
  expect(getRuntimeProgramConfig('no-such-program')).toBeUndefined();
});

it('declares one callable execution strategy for every runtime program', () => {
  for (const program of RUNTIME_PROGRAM_REGISTRY) {
    expect([
      'no-agent',
      'static',
      'resolved',
      'integration',
      'self-driving',
    ]).toContain(program.strategy);
    if (program.strategy === 'static') expect(program.run).toBeDefined();
    else expect('run' in program).toBe(false);
    if (program.strategy === 'resolved')
      expect(program.resolve).toBeTypeOf('function');
    else expect('resolve' in program).toBe(false);
  }
  expect(getRuntimeProgramConfig('agent-skill')?.strategy).toBe('resolved');
});
