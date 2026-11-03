/**
 * The run's project traits: what detection read from the user's codebase, as
 * skill criteria and flow conditions see it. Traits describe the code, never
 * the person running the wizard. Static detection and the person's own pick
 * are the sources, and context-mill never sees a trait name, only the tags
 * `traitsToSkillTags` maps values to.
 */

import { analytics } from '@utils/analytics';
import type { Integration } from '@shared/constants';
import { DiscoveredFeature } from '@shared/discovered-feature';
import { frameworkTag, type TraitTags } from '@shared/skill-resolution';
import type {
  ProgramSession,
  ProjectTraits,
  TraitSource,
} from '@programs/program-contract';

/** What static detection stored on the session that a trait reads. */
export type DetectionResults = Pick<
  ProgramSession,
  'integration' | 'discoveredFeatures'
>;

/** The session fields a framework write touches. */
type FrameworkFields = Pick<ProgramSession, 'integration' | 'projectTraits'>;

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

/** The run's traits: the written framework trait, with its source, over what detection supports. Every program in a run reads the same ones. */
export function getProjectTraits(
  session: DetectionResults & Pick<ProgramSession, 'projectTraits'>,
): ProjectTraits {
  const detected = traitsFromDetectors(session);
  const framework = session.projectTraits.framework;
  return framework ? { ...detected, framework } : detected;
}

/** The traits with the framework replaced, or removed when there is none. */
export function withFramework(
  traits: ProjectTraits,
  integration: Integration | null,
  source: TraitSource,
): ProjectTraits {
  const rest: ProjectTraits = { ...traits };
  delete rest.framework;
  return integration
    ? { ...rest, framework: { value: integration, source } }
    : rest;
}

/** Tags every later event with the run's framework and where it came from. */
export function tagFramework(
  integration: Integration,
  source: TraitSource,
): void {
  analytics.setTag('integration', integration);
  analytics.setTag('framework_source', source);
}

/**
 * Writes the run's framework onto a session draft: the trait with its source,
 * `integration` as every reader sees it, and the analytics tags. The session
 * store's `setFrameworkConfig` makes the same write on a live session.
 */
export function applyFramework(
  session: FrameworkFields,
  integration: Integration,
  source: TraitSource = 'static',
): void {
  session.integration = integration;
  session.projectTraits = withFramework(
    session.projectTraits,
    integration,
    source,
  );
  tagFramework(integration, source);
}

/** Where the framework trait and `integration` disagree, a write went around the trait path; undefined when they agree. */
export function frameworkTraitMismatch(
  session: FrameworkFields,
): { trait: string | null; integration: string | null } | undefined {
  const trait = session.projectTraits.framework?.value ?? null;
  return trait === session.integration
    ? undefined
    : { trait, integration: session.integration };
}

/** Each trait value as the tags skill criteria require or prefer. Only the framework has a skill tag today. */
export function traitsToSkillTags(traits: ProjectTraits): TraitTags {
  return traits.framework
    ? { framework: [frameworkTag(traits.framework.value)] }
    : {};
}
