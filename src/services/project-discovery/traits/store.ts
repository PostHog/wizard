/** The trait store: every source writes a project's traits through `setTrait`, and every reader settles them through `getTraits`. */

import type {
  ProgramReadyContext,
  ProgramSession,
  Project,
  Trait,
  TraitClaims,
  TraitName,
  TraitSource,
  Traits,
} from '@programs/program-contract';
import { DISCOVERY_KEY, getDiscovery, type Discovery } from '../discover';
import { TRAIT_NAMES, TRAITS } from './registry';

/** Where trait writes land: the session, and the setter that replaces its project list. */
export type TraitSink = Pick<ProgramReadyContext, 'session' | 'setProjects'>;

type Claim = Trait<unknown>;

/** The order sources are read in once a trait's own fallback sources said nothing. */
const SOURCE_ORDER: readonly TraitSource[] = ['static', 'agentic', 'decisions'];

const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item) => b.includes(item))
    : a === b;

function storedProject(
  session: ProgramSession,
  projectPath: string,
): Project | undefined {
  return session.projects.find((project) => project.path === projectPath);
}

/** Every source's value for one trait: static detection read now, the rest as kept. */
function claimsFor(
  session: ProgramSession,
  project: Project | undefined,
  projectPath: string,
  name: TraitName,
): Claim[] {
  const kept: readonly Claim[] = project?.claims?.[name] ?? [];
  const detected = TRAITS[name].detect(session, projectPath);
  if (detected === undefined) return [...kept];
  return [
    { value: detected, source: 'static' },
    ...kept.filter((claim) => claim.source !== 'static'),
  ];
}

/**
 * The value a run uses for a trait, and whether its sources settled it. The
 * person's pick settles it, and so do sources that agree. Otherwise the run
 * reads the trait's fallback source and the trait stays unsettled.
 */
function settle(
  name: TraitName,
  claims: readonly Claim[],
): { value: unknown; settled: boolean } | undefined {
  if (claims.length === 0) return undefined;
  const person = claims.find((claim) => claim.source === 'person');
  if (person) return { value: person.value, settled: true };
  if (claims.every((claim) => sameValue(claim.value, claims[0].value))) {
    return { value: claims[0].value, settled: true };
  }
  for (const source of [...TRAITS[name].fallback, ...SOURCE_ORDER]) {
    const claim = claims.find((c) => c.source === source);
    if (claim) return { value: claim.value, settled: false };
  }
  return { value: claims[0].value, settled: false };
}

function settleProject(
  session: ProgramSession,
  project: Project | undefined,
  projectPath: string,
): { traits: Traits; unsettled: TraitName[] } {
  const traits: Record<string, unknown> = {};
  const unsettled: TraitName[] = [];
  for (const name of TRAIT_NAMES) {
    const settled = settle(
      name,
      claimsFor(session, project, projectPath, name),
    );
    if (!settled) continue;
    traits[name] = settled.value;
    if (!settled.settled) unsettled.push(name);
  }
  return { traits: traits as Traits, unsettled };
}

/** The traits of one project, the run project by default: the values a run uses. */
export function getTraits(
  session: ProgramSession,
  projectPath: string = session.runProject,
): Traits {
  return settleProject(
    session,
    storedProject(session, projectPath),
    projectPath,
  ).traits;
}

/** The traits of one project whose sources disagree with no pick from the person. */
export function unsettledTraits(
  session: ProgramSession,
  projectPath: string = session.runProject,
): TraitName[] {
  return settleProject(
    session,
    storedProject(session, projectPath),
    projectPath,
  ).unsettled;
}

/** Every source's value for each trait of one project, static detection included. */
export function getTraitClaims(
  session: ProgramSession,
  projectPath: string = session.runProject,
): TraitClaims {
  const project = storedProject(session, projectPath);
  const claims: Record<string, readonly Claim[]> = {};
  for (const name of TRAIT_NAMES) {
    const all = claimsFor(session, project, projectPath, name);
    if (all.length > 0) claims[name] = all;
  }
  return claims as TraitClaims;
}

/** One project as readers get it: its settled traits beside what its sources said. */
function toProject(session: ProgramSession, project: Project): Project {
  const { traits, unsettled } = settleProject(session, project, project.path);
  return {
    path: project.path,
    traits,
    ...(project.claims && { claims: project.claims }),
    ...(unsettled.length > 0 && { unsettled }),
  };
}

/** Every project with its settled traits. A session discovery has not reached holds the run project alone. */
export function getProjects(session: ProgramSession): Project[] {
  const stored =
    session.projects.length > 0
      ? session.projects
      : [{ path: session.runProject, traits: {} }];
  return stored.map((project) => toProject(session, project));
}

/** The run project with its traits. */
export function getProject(session: ProgramSession): Project {
  return toProject(
    session,
    storedProject(session, session.runProject) ?? {
      path: session.runProject,
      traits: {},
    },
  );
}

/** One source's value for one trait of one project. */
export type TraitWrite = {
  [K in TraitName]: {
    projectPath: string;
    name: K;
    value: NonNullable<Traits[K]>;
    source: TraitSource;
    confidence?: number;
  };
}[TraitName];

/** Write several traits at once. A path the session has no project for becomes one. */
export function setTraits(
  sink: TraitSink,
  writes: readonly TraitWrite[],
): void {
  const { session } = sink;
  const projects = new Map<string, Project>(
    session.projects.map((project) => [project.path, project]),
  );
  for (const write of writes) {
    const project = projects.get(write.projectPath) ?? {
      path: write.projectPath,
      traits: {},
    };
    const kept: readonly Claim[] = project.claims?.[write.name] ?? [];
    const claim: Claim = {
      value: write.value,
      source: write.source,
      ...(write.confidence !== undefined && { confidence: write.confidence }),
    };
    projects.set(write.projectPath, {
      ...project,
      claims: {
        ...project.claims,
        [write.name]: [...kept.filter((c) => c.source !== write.source), claim],
      } as TraitClaims,
    });
  }
  sink.setProjects(
    [...projects.values()].map((project) => toProject(session, project)),
    session.runProject,
  );
}

/** The one setter every source writes through: static detectors, Decisions, agentic detection and the person. */
export function setTrait<K extends TraitName>(
  sink: TraitSink,
  projectPath: string,
  name: K,
  value: NonNullable<Traits[K]>,
  source: TraitSource,
  confidence?: number,
): void {
  setTraits(sink, [
    { projectPath, name, value, source, confidence } as TraitWrite,
  ]);
}

/** The traits static detection reads from the session, which holds them for the run project only. */
const SESSION_TRAITS = [
  'framework',
  'frameworkVariant',
  'mcpServers',
  'warehouseSources',
] as const;

/** Keep what static detection read for the run project in the discovery, so a run that moves to another project still knows it. */
function keepRunProjectDetection(sink: DetectionSink): void {
  const { session } = sink;
  const discovery = getDiscovery(session);
  if (!discovery) return;
  const detected: Record<string, unknown> = {};
  for (const name of SESSION_TRAITS) {
    const value = TRAITS[name].detect(session, session.runProject);
    if (value !== undefined) detected[name] = value;
  }
  sink.setFrameworkContext(DISCOVERY_KEY, {
    ...discovery,
    detected: { ...discovery.detected, [session.runProject]: detected },
  } satisfies Discovery);
}

/** Where {@link settleProjects} writes: the trait sink, and the discovery. */
export type DetectionSink = TraitSink &
  Pick<ProgramReadyContext, 'setFrameworkContext'>;

/**
 * Call once a program's detection has run. It keeps the run project's static
 * detection in the discovery, and refreshes the settled traits the session
 * keeps on each project.
 */
export function settleProjects(sink: DetectionSink): void {
  keepRunProjectDetection(sink);
  sink.setProjects(getProjects(sink.session), sink.session.runProject);
}
