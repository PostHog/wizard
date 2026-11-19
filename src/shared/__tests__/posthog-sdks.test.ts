import { describe, expect, it } from 'vitest';
import { Integration } from '@shared/constants';
import {
  POSTHOG_SDK_SPECS,
  resolveSdkSkillEntries,
  sdkFamiliesForRun,
  sdkSpecForFamily,
} from '@shared/posthog-sdks';

describe('shared posthog-sdks', () => {
  it('resolves SDK families from detected sdk* matchKeys or frameworkSdkFamily', () => {
    expect(
      sdkFamiliesForRun(
        { framework: [Integration.nextjs], sdkNode: ['5'] },
        'sdk-posthog-node',
      ),
    ).toEqual(['sdk-posthog-node']);

    expect(
      sdkFamiliesForRun(
        { framework: [Integration.fastapi] },
        'sdk-posthog-python',
      ),
    ).toEqual(['sdk-posthog-python']);

    expect(
      sdkFamiliesForRun({ sdkGo: ['1'], sdkRust: ['0'] }, undefined),
    ).toEqual(['sdk-posthog-go', 'sdk-posthog-rust']);
  });

  it('fans out multi-major matchKeys per major in resolveSdkSkillEntries', () => {
    const entries = [
      {
        id: 'sdk-posthog-node-v5',
        name: 'Node v5',
        downloadUrl: 'https://skills.test/v5.zip',
        family: 'sdk-posthog-node',
        tags: ['sdkNode:5', 'sdk-posthog-node'],
      },
      {
        id: 'sdk-posthog-node-v6',
        name: 'Node v6',
        downloadUrl: 'https://skills.test/v6.zip',
        family: 'sdk-posthog-node',
        tags: ['sdkNode:6', 'sdk-posthog-node', 'default'],
      },
    ];
    const picks = resolveSdkSkillEntries({
      menuEntries: entries,
      matchKeys: { framework: [Integration.nextjs], sdkNode: ['5', '6'] },
      frameworkSdkFamily: 'sdk-posthog-node',
    });
    expect(picks).toEqual([
      expect.objectContaining({
        kind: 'ok',
        entry: expect.objectContaining({ id: 'sdk-posthog-node-v5' }),
      }),
      expect.objectContaining({
        kind: 'ok',
        entry: expect.objectContaining({ id: 'sdk-posthog-node-v6' }),
      }),
    ]);
  });

  it('maps server SDK families to specs and omits families for mobile SDKs', () => {
    expect(sdkSpecForFamily('sdk-posthog-python')).toBe(
      POSTHOG_SDK_SPECS['posthog-python'],
    );
    expect(sdkSpecForFamily('sdk-posthog-unknown')).toBeUndefined();
    expect(POSTHOG_SDK_SPECS['posthog-ios'].family).toBeUndefined();
    expect(POSTHOG_SDK_SPECS['posthog-android'].family).toBeUndefined();
    expect(POSTHOG_SDK_SPECS['posthog-flutter'].family).toBeUndefined();
  });
});
