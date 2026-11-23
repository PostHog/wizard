/** Project traits: what the wizard knows about one project's code. `@services/project-discovery` produces the values. */

import type { Integration } from '@shared/constants';

/** One project's traits. A trait no source settles is absent. */
export type Traits = {
  /** The framework the wizard integrates. */
  framework?: Integration;
  /** The framework's variant as its config reads it, such as `pages-router` or `expo`. */
  frameworkVariant?: string;
  /** `yes` when an LLM SDK is a dependency. Its absence proves nothing, so static detection never says `no`. */
  callsLlmApi?: 'yes' | 'no';
  /** Paths the MCP scan suggests as servers, relative to the project. */
  mcpServers?: readonly string[];
  /** The kinds of data source detection found. */
  warehouseSources?: readonly string[];
  /** Whether a PostHog SDK is among the project's dependencies. */
  posthogInstalled?: 'yes' | 'no';
  /** The SDKs the project depends on, by id: `posthog`, `stripe` and other analytics providers. */
  installedSdks?: readonly string[];
  /** What the project is: an app has a framework, a library is a workspace package without one, tooling is config only. */
  projectRole?: 'app' | 'library' | 'tooling';
  /** The path of the workspace root the project belongs to; its own path on a root. Absent outside any workspace. */
  workspaceRoot?: string;
  /** `yes` when the project serves a web UI. */
  webFrontend?: 'yes' | 'no';
  /** `yes` on the project a source picked as the repo's main app. */
  mainApp?: 'yes';
};

export type TraitName = keyof Traits;

/** Who said a trait's value: static detection, Decisions, agentic detection or the person. */
export type TraitSource = 'static' | 'decisions' | 'agentic' | 'person';

/** One source's value for a trait. */
export type Trait<T> = {
  value: T;
  source: TraitSource;
  /** The source's probability for the value, from 0 to 1. Absent when it gives none. */
  confidence?: number;
};

/** What each source but static detection said about a project, one value per source and trait. */
export type TraitClaims = {
  readonly [K in TraitName]?: readonly Trait<NonNullable<Traits[K]>>[];
};

/** A directory in the repo with its traits. Its path is relative to the workspace root, so `.` is that root. */
export type Project = {
  path: string;
  /** The values a run uses: where sources agree, the person's, else the trait's fallback source's. */
  traits: Traits;
  /** What Decisions, agentic detection and the person said. Static detection is read, not kept. */
  claims?: TraitClaims;
  /** The traits whose sources disagree with no pick from the person. */
  unsettled?: readonly TraitName[];
};
