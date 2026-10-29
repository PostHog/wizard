/**
 * The run's project traits: what detection read from the user's codebase, as
 * skill criteria and flow conditions see it. Traits describe the code, never
 * the person running the wizard. Static detection is the only source, and
 * context-mill never sees a trait name, only the tags `traitsToSkillTags` maps
 * values to.
 */

import { DiscoveredFeature } from '@shared/discovered-feature';
import { frameworkTag, type TraitTags } from '@shared/skill-resolution';
import type { ProgramSession } from '@programs/program-contract';

export type TraitName = 'framework' | 'callsLlmApi';

/** A predicate trait's value is `yes` or `no`; the framework's is its integration id. */
export type Trait = {
  value: string;
  source: 'static';
};

export type ProjectTraits = Partial<Record<TraitName, Trait>>;

/** What static detection stored on the session that a trait reads. */
export type DetectionResults = Pick<
  ProgramSession,
  'integration' | 'discoveredFeatures'
>;

/** The traits static detection supports. A trait no detector settles is absent. */
export function traitsFromDetectors(scan: DetectionResults): ProjectTraits {
  const traits: ProjectTraits = {};
  if (scan.integration) {
    traits.framework = { value: scan.integration, source: 'static' };
  }
  // An LLM SDK in the dependencies says the app calls one; no SDK proves nothing, so never `no`.
  if (scan.discoveredFeatures.includes(DiscoveredFeature.LLM)) {
    traits.callsLlmApi = { value: 'yes', source: 'static' };
  }
  return traits;
}

/** The run's traits. Every program in a run reads the same ones. */
export function getProjectTraits(session: DetectionResults): ProjectTraits {
  return traitsFromDetectors(session);
}

/** Each trait value as the tags skill criteria require or prefer. Only the framework has a skill tag today. */
export function traitsToSkillTags(traits: ProjectTraits): TraitTags {
  return traits.framework
    ? { framework: [frameworkTag(traits.framework.value)] }
    : {};
}
