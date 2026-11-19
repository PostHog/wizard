import { describe, expect, it } from 'vitest';
import { Integration } from '@shared/constants';
import {
  POSTHOG_SDK_SPECS,
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
