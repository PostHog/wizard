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
import { getDiscovery } from '../discover';
import { manifestDir } from '../walk';
import { POSTHOG_SDK, sdksIn } from './sdks';

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

const nonEmpty = <T>(list: readonly T[]): readonly T[] | undefined =>
  list.length > 0 ? list : undefined;

const isRunProject = (session: ProgramSession, projectPath: string): boolean =>
  projectPath === session.runProject;

/** The manifests of one project, read by the walk. */
function manifestsOf(session: ProgramSession, projectPath: string) {
  const manifests = getDiscovery(session)?.files.manifests ?? [];
  return manifests.filter((m) => manifestDir(m.path) === projectPath);
}

const packagesOf = (session: ProgramSession, projectPath: string): string[] =>
  manifestsOf(session, projectPath).flatMap((m) => m.packages);

function frameworkOf(session: ProgramSession, projectPath: string) {
  return isRunProject(session, projectPath)
    ? session.integration ?? undefined
    : getDiscovery(session)?.detected[projectPath]?.framework;
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
    matchKey: 'variant',
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
      isRunProject(session, projectPath)
        ? nonEmpty(session.mcpServerCandidates)
        : undefined,
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
