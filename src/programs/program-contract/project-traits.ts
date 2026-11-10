/** Project traits: what detection read from one project's code. `@services/project-traits` produces the values. */

import type { Integration } from '@shared/constants';

/** Where a trait's value came from. Static detection is the only source so far. */
export type TraitSource = 'user' | 'decisions' | 'static' | 'agent';

export type Trait<T> = {
  value: T;
  source: TraitSource;
  /** Set by model sources. */
  confidence?: number;
};

/** One project's traits. A trait no detector settles is absent. */
export type Traits = {
  /** The framework the wizard integrates. */
  framework?: Trait<Integration>;
  /** The framework's variant as its config detects it, such as `pages-router` or `expo`. */
  variant?: Trait<string>;
  /** `yes` when an LLM SDK is a dependency. Its absence proves nothing, so never `no` from static detection. */
  callsLlmApi?: Trait<'yes' | 'no'>;
  /** Paths the MCP scan suggests as servers, relative to the project. */
  mcpServers?: Trait<readonly string[]>;
  /** The kinds of data source detection found. */
  warehouseSources?: Trait<readonly string[]>;
};

export type TraitName = keyof Traits;

/** A directory in the repo with its traits. `.` is the directory the run works in. */
export type Project = { path: string; traits: Traits };
