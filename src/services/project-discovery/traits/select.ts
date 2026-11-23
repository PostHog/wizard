/** Selecting projects on their settled traits: every reader that chooses is one predicate. */

import type {
  ProgramSession,
  Project,
  Traits,
} from '@programs/program-contract';
import { getProjects } from './store';

/** A choice over one project's settled traits. */
export type ProjectPredicate = (traits: Traits, project: Project) => boolean;

/** The projects whose settled traits satisfy `predicate`, in discovery order. */
export function selectProjects(
  session: ProgramSession,
  predicate: ProjectPredicate,
): Project[] {
  return getProjects(session).filter((project) =>
    predicate(project.traits, project),
  );
}
