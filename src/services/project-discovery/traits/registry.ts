/** The trait registry: every trait declared once, with its static detector, fallback source and match key; see the [README](../../README.md#project-traits). */

import path from 'path';
import { Integration } from '@shared/constants';
import { DiscoveredFeature } from '@shared/discovered-feature';
import type {
  ProgramSession,
  TraitName,
  TraitSource,
  Traits,
} from '@programs/program-contract';
import { usesLlmSdk } from '../../detection/features';
import { FRAMEWORK_REGISTRY } from '../../frameworks/registry';
import { getDetectedWarehouseSources } from '../../warehouse-sources/detect';
import { detectedProjectOf, getDiscovery } from '../discover';
import type { RepoFiles } from '../walk';
import {
  POSTHOG_SDK,
  posthogSdkVersions,
  sdksIn,
  type DeclaredSdk,
} from './sdks';

export type TraitDefinition<K extends TraitName> = {
  /**
   * Static detection: the value read in one project, by its path from the
   * workspace root. Undefined when detection settles nothing. The run project
   * reads what the program's own detection left on the session.
   */
  detect: (
    session: ProgramSession,
    projectPath: string,
  ) => NonNullable<Traits[K]> | undefined;
  /**
   * The sources a run reads, first present first, when the trait's sources
   * disagree and nobody picks: the source today's code reads for it.
   */
  fallback: readonly TraitSource[];
  /** Skills can match on it, as a `<key>:<value>` tag. `true` keys by the trait's name. */
  matchKey?: true | string;
};

const STATIC: readonly TraitSource[] = ['static'];

/** FrameworkContext key: whether the run reads PostHog SDK versions, set from `wizard-versioned-sdk-skills`. */
export const VERSIONED_SDK_SKILLS_ENABLED_KEY = 'versionedSdkSkillsEnabled';

const nonEmpty = <T>(list: readonly T[]): readonly T[] | undefined =>
  list.length > 0 ? list : undefined;

/** Whether the session's own detection fields describe `projectPath`. A step scoped to another folder reads that folder from discovery. */
const isRunProject = (session: ProgramSession, projectPath: string): boolean =>
  projectPath === detectedProjectOf(session);

type Manifests = RepoFiles['manifests'];

/** Each walk's manifests by project directory, indexed once: every trait read of every project looks here. */
const MANIFESTS_BY_DIR = new WeakMap<Manifests, Map<string, Manifests>>();

/** The manifests of one project, read by the walk. */
function manifestsOf(session: ProgramSession, projectPath: string): Manifests {
  const manifests = getDiscovery(session)?.files.manifests;
  if (!manifests) return [];
  let byDir = MANIFESTS_BY_DIR.get(manifests);
  if (!byDir) {
    byDir = new Map();
    for (const manifest of manifests) {
      if (manifest.dir === null) continue;
      byDir.set(manifest.dir, [...(byDir.get(manifest.dir) ?? []), manifest]);
    }
    MANIFESTS_BY_DIR.set(manifests, byDir);
  }
  return byDir.get(projectPath) ?? [];
}

const packagesOf = (session: ProgramSession, projectPath: string): string[] =>
  manifestsOf(session, projectPath).flatMap((m) => m.packages);

/** The PostHog SDKs one project declares, while versioned SDK skills are on. */
export function declaredSdks(
  session: ProgramSession,
  projectPath: string = session.runProject,
): DeclaredSdk[] {
  return session.frameworkContext[VERSIONED_SDK_SKILLS_ENABLED_KEY] === true
    ? posthogSdkVersions(manifestsOf(session, projectPath))
    : [];
}

function frameworkOf(session: ProgramSession, projectPath: string) {
  if (isRunProject(session, projectPath)) {
    return session.integration ?? undefined;
  }
  const detected = getDiscovery(session)?.detected[projectPath];
  // A scoped step in a folder discovery detected nothing in keeps what its own prep found.
  if (!detected && projectPath === session.runProject) {
    return session.integration ?? undefined;
  }
  return detected?.framework;
}

/** The workspace that holds the project as its root or as a member, innermost first. */
function workspaceOf(session: ProgramSession, projectPath: string) {
  const workspaces = getDiscovery(session)?.projects.workspaces ?? [];
  return [...workspaces]
    .reverse()
    .find(
      (workspace) =>
        workspace.members.includes(projectPath) ||
        workspace.root === projectPath,
    );
}

/** Config-only packages: lint, format, compiler and test presets. */
const TOOLING_NAME =
  /(^|[-_])(eslint|prettier|tsconfig|typescript|stylelint|jest|babel)([-_]|$)|(^|[-_])configs?$|^tooling$/;

/** The first path segment of a workspace's library members. */
const LIBRARY_DIRS = new Set(['packages', 'libs', 'libraries']);

/** The language fallbacks match any manifest of their language, so one alone does not make a package an app. */
const LANGUAGE_FALLBACKS: ReadonlySet<Integration> = new Set([
  Integration.python,
  Integration.ruby,
  Integration.javascript_web,
  Integration.javascriptNode,
]);

/** Whether a framework is a language fallback, which says what a package is written in, not what app it is. */
export function isLanguageFallback(framework: Integration): boolean {
  return LANGUAGE_FALLBACKS.has(framework);
}

/** Every trait, declared once. */
export const TRAITS: { readonly [K in TraitName]: TraitDefinition<K> } = {
  framework: {
    detect: frameworkOf,
    fallback: STATIC,
    matchKey: true,
  },
  frameworkVariant: {
    detect: (session, projectPath) => {
      if (!isRunProject(session, projectPath)) {
        return getDiscovery(session)?.detected[projectPath]?.frameworkVariant;
      }
      return session.integration
        ? FRAMEWORK_REGISTRY[session.integration].metadata.getVariant?.(
            session.frameworkContext,
          )
        : undefined;
    },
    fallback: STATIC,
    matchKey: true,
  },
  callsLlmApi: {
    detect: (session, projectPath) => {
      const calls = isRunProject(session, projectPath)
        ? session.discoveredFeatures.includes(DiscoveredFeature.LLM)
        : manifestsOf(session, projectPath).some((m) =>
            usesLlmSdk(m.ecosystem, m.packages),
          );
      return calls ? 'yes' : undefined;
    },
    fallback: STATIC,
  },
  mcpServers: {
    detect: (session, projectPath) =>
      nonEmpty(
        isRunProject(session, projectPath)
          ? session.mcpServerCandidates
          : getDiscovery(session)?.detected[projectPath]?.mcpServers ?? [],
      ),
    fallback: STATIC,
  },
  warehouseSources: {
    detect: (session, projectPath) =>
      nonEmpty(
        isRunProject(session, projectPath)
          ? getDetectedWarehouseSources(session).map((s) => s.kind)
          : getDiscovery(session)?.detected[projectPath]?.warehouseSources ??
              [],
      ),
    fallback: STATIC,
  },
  posthogInstalled: {
    detect: (session, projectPath) => {
      const manifests = manifestsOf(session, projectPath);
      if (manifests.length === 0) return undefined;
      return sdksIn(manifests.flatMap((m) => m.packages)).includes(POSTHOG_SDK)
        ? 'yes'
        : 'no';
    },
    fallback: STATIC,
  },
  installedSdks: {
    detect: (session, projectPath) =>
      nonEmpty(sdksIn(packagesOf(session, projectPath))),
    fallback: STATIC,
  },
  posthogSdks: {
    detect: (session, projectPath) =>
      nonEmpty(
        declaredSdks(session, projectPath).map(
          ({ ecosystem, name, version }) =>
            `${ecosystem}:${name.toLowerCase()}@${version.split('.')[0]}`,
        ),
      ),
    fallback: STATIC,
    matchKey: true,
  },
  projectRole: {
    detect: (session, projectPath) => {
      const framework = frameworkOf(session, projectPath);
      if (framework && !LANGUAGE_FALLBACKS.has(framework)) return 'app';
      if (TOOLING_NAME.test(path.posix.basename(projectPath))) return 'tooling';
      const workspace = workspaceOf(session, projectPath);
      const fromRoot =
        workspace && workspace.root !== projectPath
          ? path.posix.relative(workspace.root, projectPath)
          : '';
      if (LIBRARY_DIRS.has(fromRoot.split('/')[0])) return 'library';
      return framework ? 'app' : undefined;
    },
    fallback: STATIC,
  },
  workspaceRoot: {
    detect: (session, projectPath) => workspaceOf(session, projectPath)?.root,
    fallback: STATIC,
  },
  webFrontend: {
    detect: (session, projectPath) => {
      const framework = frameworkOf(session, projectPath);
      return framework && FRAMEWORK_REGISTRY[framework].metadata.webFrontend
        ? 'yes'
        : undefined;
    },
    fallback: STATIC,
  },
  mainApp: {
    // No static detector: only a model source or the person names the main app.
    detect: () => undefined,
    fallback: ['agentic', 'decisions'],
  },
};

/** Every trait name, in registry order. */
export const TRAIT_NAMES = Object.keys(TRAITS) as TraitName[];
