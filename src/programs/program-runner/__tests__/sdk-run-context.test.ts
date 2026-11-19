import { Integration } from '@shared/constants';
import { FRAMEWORK_REGISTRY } from '@services/frameworks';
import { buildSession } from '@services/session';
import {
  frameworkSdkSkillFamily,
  hasOwnTargetDir,
  ownTargetDir,
  programMatchKeys,
} from '../sdk-run-context';
import { POSTHOG_SDKS_KEY } from '@services/detection';

const python7 = {
  key: 'posthog-python',
  packageName: 'posthog',
  major: 7,
  constraintKind: 'range',
  rawSpec: '>=7.0.0,<8',
  source: 'requirements.txt',
};

describe('programMatchKeys', () => {
  const session = buildSession({ installDir: '/project' });
  session.frameworkContext = { [POSTHOG_SDKS_KEY]: [python7] };

  it('keeps the SDK majors for an sdkSupport program', () => {
    expect(programMatchKeys(session, { sdkSupport: true })).toMatchObject({
      sdkPython: ['7'],
    });
  });

  it('drops them for a program without sdkSupport, and keeps the rest', () => {
    const detected = { ...session, integration: Integration.nextjs };
    const keys = programMatchKeys(detected, {});
    expect(keys.sdkPython).toBeUndefined();
    expect(keys.framework).toEqual(['nextjs']);
    expect(programMatchKeys(detected, { sdkSupport: true }).framework).toEqual([
      'nextjs',
    ]);
  });
});

describe('frameworkSdkSkillFamily', () => {
  const family = FRAMEWORK_REGISTRY[Integration.nextjs].metadata.sdkSkillFamily;

  it('reads the framework config, then the integration, then the skill id', () => {
    expect(family).toBeTruthy();
    expect(
      frameworkSdkSkillFamily({
        frameworkConfig: FRAMEWORK_REGISTRY[Integration.nextjs],
        integration: null,
        skillId: null,
      }),
    ).toBe(family);
    expect(
      frameworkSdkSkillFamily({
        frameworkConfig: null,
        integration: Integration.nextjs,
        skillId: null,
      }),
    ).toBe(family);
    expect(
      frameworkSdkSkillFamily({
        frameworkConfig: null,
        integration: null,
        skillId: Integration.nextjs,
      }),
    ).toBe(family);
    expect(
      frameworkSdkSkillFamily({
        frameworkConfig: null,
        integration: null,
        skillId: null,
      }),
    ).toBeUndefined();
  });
});

describe('frameworkSdkSkillFamily precedence', () => {
  const nextjs = FRAMEWORK_REGISTRY[Integration.nextjs];
  const pythonFamily =
    FRAMEWORK_REGISTRY[Integration.django].metadata.sdkSkillFamily;

  it('prefers the framework config, then the integration, then the skill id', () => {
    expect(pythonFamily).not.toBe(nextjs.metadata.sdkSkillFamily);
    expect(
      frameworkSdkSkillFamily({
        frameworkConfig: nextjs,
        integration: Integration.django,
        skillId: Integration.django,
      }),
    ).toBe(nextjs.metadata.sdkSkillFamily);
    expect(
      frameworkSdkSkillFamily({
        frameworkConfig: null,
        integration: Integration.django,
        skillId: Integration.nextjs,
      }),
    ).toBe(pythonFamily);
  });

  it('has no family for a framework the registry does not know', () => {
    expect(
      frameworkSdkSkillFamily({
        frameworkConfig: null,
        integration: null,
        skillId: 'not-a-framework',
      }),
    ).toBeUndefined();
  });
});

describe('own target directory', () => {
  const session = buildSession({ installDir: '/project' });
  const targetDir = () => '/project/apps/web';

  it('finds a target dir on an own run step under any key', () => {
    expect(hasOwnTargetDir({ runSteps: { run: { targetDir } } })).toBe(true);
    expect(hasOwnTargetDir({ runSteps: { 'scoped-run': { targetDir } } })).toBe(
      true,
    );
    expect(
      ownTargetDir({ runSteps: { 'scoped-run': { targetDir } } }, session),
    ).toBe('/project/apps/web');
  });

  it('takes the last own run step, ignoring composed ones after it', () => {
    const runSteps = {
      first: { targetDir: () => '/project/apps/first' },
      last: { targetDir: () => '/project/apps/last' },
      composed: { runProgramId: 'metrics', targetDir: () => '/project/other' },
    };
    expect(ownTargetDir({ runSteps }, session)).toBe('/project/apps/last');
  });

  it('passes the session to the step and keeps a step without a target dir', () => {
    const targetDir = vi.fn(() => '/project/apps/web');
    ownTargetDir({ runSteps: { run: { targetDir } } }, session);
    expect(targetDir).toHaveBeenCalledExactlyOnceWith(session);
    expect(hasOwnTargetDir({ runSteps: { run: {} } })).toBe(false);
  });

  it('ignores composed steps and configs without one', () => {
    expect(
      hasOwnTargetDir({
        runSteps: { 'integrate-run': { runProgramId: 'metrics', targetDir } },
      }),
    ).toBe(false);
    expect(hasOwnTargetDir({})).toBe(false);
    expect(hasOwnTargetDir(undefined)).toBe(false);
    expect(ownTargetDir({}, session)).toBeUndefined();
  });
});
