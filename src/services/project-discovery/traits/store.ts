/** Reading a project's traits from the session. */

import type {
  ProgramSession,
  Project,
  TraitName,
  Traits,
} from '@programs/program-contract';
import { RUN_PROJECT, TRAIT_NAMES, TRAITS } from './registry';

/** The traits of one project. Detection covers the run's own directory; any other path has none yet. */
export function getTraits(
  session: ProgramSession,
  projectPath: string = RUN_PROJECT,
): Traits {
  const traits: Traits = {};
  if (projectPath !== RUN_PROJECT) return traits;
  const assign = <K extends TraitName>(name: K): void => {
    const value = TRAITS[name].detect(session);
    if (value !== undefined) traits[name] = value;
  };
  TRAIT_NAMES.forEach(assign);
  return traits;
}

/** The run's project with its traits. */
export function getProject(session: ProgramSession): Project {
  return { path: RUN_PROJECT, traits: getTraits(session) };
}
