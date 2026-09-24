import { PROGRAM_REGISTRY } from '../program-registry';
import { postAuthGateSteps } from '@tui/flow';
import { rawProgramFlow } from '@tui/flows/index';
import {
  RUNTIME_PROGRAM_REGISTRY,
  getRuntimeProgramConfig,
} from '../runtime-registry';
import { HostResolution } from '@shared/host-resolution';

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

it('declares the health check, post-auth gates and composed runs the TUI flows carry', () => {
  for (const legacy of PROGRAM_REGISTRY) {
    const runtime = getRuntimeProgramConfig(legacy.id);
    const flow = rawProgramFlow(legacy.id);
    expect(runtime?.healthCheck ?? true).toBe(
      flow.some((step) => step.screenId === 'health-check'),
    );
    expect(runtime?.postAuthGates ?? []).toEqual(
      postAuthGateSteps(flow).map((step) => step.id),
    );
    expect(runtime?.composedRuns ?? []).toEqual(
      flow.flatMap((step) => {
        const runProgramId = legacy.runSteps?.[step.id]?.runProgramId;
        return runProgramId ? [{ stepId: step.id, runProgramId }] : [];
      }),
    );
    for (const composed of runtime?.composedRuns ?? []) {
      expect(getRuntimeProgramConfig(composed.runProgramId)).toBeDefined();
    }
  }
});
