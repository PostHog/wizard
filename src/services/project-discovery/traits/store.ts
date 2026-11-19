/** Reading a project's traits from the session. */

import type {
  ProgramSession,
  Project,
  TraitName,
  Traits,
} from '@programs/program-contract';
import { TRAIT_NAMES, TRAITS } from './registry';

/** The traits of one project, the run project by default. Detection covers the run project; any other path has none yet. */
export function getTraits(
  session: ProgramSession,
  projectPath: string = session.runProject,
): Traits {
  const traits: Traits = {};
  if (projectPath !== session.runProject) return traits;
  const assign = <K extends TraitName>(name: K): void => {
    const value = TRAITS[name].detect(session);
    if (value !== undefined) traits[name] = value;
  };
  TRAIT_NAMES.forEach(assign);
  return traits;
}

/** The run project with its traits. */
export function getProject(session: ProgramSession): Project {
  return { path: session.runProject, traits: getTraits(session) };
}
