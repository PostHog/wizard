/** Project traits: what detection read from one project's code. `@services/project-traits` produces the values. */

import type { Integration } from '@shared/constants';

/** One project's traits. A trait no detector settles is absent. */
export type Traits = {
  /** The framework the wizard integrates. */
  framework?: Integration;
  /** The framework's variant as its config reads it, such as `pages-router` or `expo`. */
  frameworkVariant?: string;
  /** `yes` when an LLM SDK is a dependency. Its absence proves nothing, so detection never says `no`. */
  callsLlmApi?: 'yes' | 'no';
  /** Paths the MCP scan suggests as servers, relative to the project. */
  mcpServers?: readonly string[];
  /** The kinds of data source detection found. */
  warehouseSources?: readonly string[];
};

export type TraitName = keyof Traits;

/** A directory in the repo with its traits. `.` is the directory the run works in. */
export type Project = { path: string; traits: Traits };
