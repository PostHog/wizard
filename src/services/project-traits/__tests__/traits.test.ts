import { describe, expect, it } from 'vitest';
import { DiscoveredFeature } from '@shared/discovered-feature';
import { Integration } from '@shared/constants';
import {
  getProjectTraits,
  traitsFromDetectors,
  traitsToSkillTags,
} from '@services/project-traits/traits';

describe('traitsFromDetectors', () => {
  it('reads the framework from detection', () => {
    expect(
      traitsFromDetectors({
        integration: Integration.nextjs,
        discoveredFeatures: [],
      }),
    ).toEqual({ framework: { value: 'nextjs', source: 'static' } });
  });

  it('leaves a trait no detector settles absent', () => {
    expect(
      traitsFromDetectors({ integration: null, discoveredFeatures: [] }),
    ).toEqual({});
  });

  it('says yes to LLM calls when an LLM SDK is a dependency, and never no', () => {
    expect(
      traitsFromDetectors({
        integration: null,
        discoveredFeatures: [DiscoveredFeature.LLM],
      }).callsLlmApi,
    ).toEqual({ value: 'yes', source: 'static' });
    expect(
      traitsFromDetectors({
        integration: null,
        discoveredFeatures: [DiscoveredFeature.Stripe],
      }).callsLlmApi,
    ).toBeUndefined();
  });

  it('gives every program in a run the same traits', () => {
    const session = {
      integration: Integration.django,
      discoveredFeatures: [DiscoveredFeature.LLM],
    };
    expect(getProjectTraits(session)).toEqual(traitsFromDetectors(session));
  });
});

describe('traitsToSkillTags', () => {
  it('maps the framework to its prefixed tag', () => {
    expect(
      traitsToSkillTags({
        framework: { value: 'javascript_web', source: 'static' },
      }),
    ).toEqual({ framework: ['framework:javascript_web'] });
  });

  it('gives a trait without a skill tag no tags', () => {
    expect(
      traitsToSkillTags({ callsLlmApi: { value: 'yes', source: 'static' } }),
    ).toEqual({});
  });
});
