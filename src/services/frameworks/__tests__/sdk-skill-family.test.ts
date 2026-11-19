import { describe, expect, it } from 'vitest';
import { Integration } from '@shared/constants';
import { sdkSpecForFamily } from '@shared/posthog-sdks';
import { FRAMEWORK_REGISTRY } from '../registry';

const EXPECTED_SERVER_FAMILIES: Partial<Record<Integration, string>> = {
  [Integration.python]: 'sdk-posthog-python',
  [Integration.django]: 'sdk-posthog-python',
  [Integration.flask]: 'sdk-posthog-python',
  [Integration.fastapi]: 'sdk-posthog-python',
  [Integration.javascriptNode]: 'sdk-posthog-node',
  [Integration.nextjs]: 'sdk-posthog-node',
  [Integration.nuxt]: 'sdk-posthog-node',
  [Integration.sveltekit]: 'sdk-posthog-node',
  [Integration.reactRouter]: 'sdk-posthog-node',
  [Integration.tanstackStart]: 'sdk-posthog-node',
  [Integration.astro]: 'sdk-posthog-node',
  [Integration.go]: 'sdk-posthog-go',
  [Integration.rust]: 'sdk-posthog-rust',
};

describe('FrameworkConfig sdkSkillFamily alignment', () => {
  it('aligns every registered FrameworkConfig sdkSkillFamily with POSTHOG_SDK_SPECS', () => {
    for (const integration of Object.values(Integration)) {
      const config = FRAMEWORK_REGISTRY[integration];
      expect(config).toBeDefined();
      const family = config.metadata.sdkSkillFamily;
      expect(family).toBe(EXPECTED_SERVER_FAMILIES[integration]);
      if (family) {
        expect(sdkSpecForFamily(family)).toBeDefined();
      }
    }
  });
});
