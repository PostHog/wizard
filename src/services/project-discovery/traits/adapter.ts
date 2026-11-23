/** The detection report adapter: an `AgenticDetectionReport`, from agentic detection or Decisions, as trait writes. */

import path from 'path';
import { Integration } from '@shared/constants';
import type { TraitSource } from '@programs/program-contract';
import type {
  AgenticDetectionReport,
  AgenticProject,
} from '../../detection/agentic';
import { getDiscovery } from '../discover';
import { setTraits, type TraitSink, type TraitWrite } from './store';

const INTEGRATIONS = new Set<string>(Object.values(Integration));

/** A project path from one directory as a path from the directory `base` is relative to. Backslashes and a trailing slash name the same project. */
export function joinProjectPath(base: string, projectPath: string): string {
  const joined = path.posix.normalize(
    path.posix.join(base, projectPath.replaceAll('\\', '/')),
  );
  const trimmed = joined.endsWith('/') ? joined.slice(0, -1) : joined;
  return trimmed === '' ? '.' : trimmed;
}

/** The directory a report's paths are relative to, as a path from the workspace root. */
function reportBase(sink: TraitSink): string {
  const { session } = sink;
  const rootDir = getDiscovery(session)?.rootDir;
  if (!rootDir) return session.runProject;
  const relative = path.relative(rootDir, session.installDir);
  return relative === '' ? '.' : relative.split(path.sep).join('/');
}

/**
 * Write a detection report's answers as traits: `targetId` as `framework`,
 * `recommended` as the main-app mark and `hasPostHog` as `posthogInstalled`.
 * A path the session has no project for becomes one.
 */
export function applyDetectionReport(
  sink: TraitSink,
  report: AgenticDetectionReport,
  source: Extract<TraitSource, 'agentic' | 'decisions'>,
  /** The source's probability for one project's answers; agentic detection gives none. */
  confidence?: (project: AgenticProject) => number | undefined,
): void {
  const base = reportBase(sink);
  const writes: TraitWrite[] = [];
  for (const project of report.projects) {
    const projectPath = joinProjectPath(base, project.path);
    const from = { projectPath, source, confidence: confidence?.(project) };
    if (project.targetId && INTEGRATIONS.has(project.targetId)) {
      writes.push({
        ...from,
        name: 'framework',
        value: project.targetId as Integration,
      });
    }
    if (project.recommended === true) {
      writes.push({ ...from, name: 'mainApp', value: 'yes' });
    }
    writes.push({
      ...from,
      name: 'posthogInstalled',
      value: project.hasPostHog ? 'yes' : 'no',
    });
  }
  setTraits(sink, writes);
}
