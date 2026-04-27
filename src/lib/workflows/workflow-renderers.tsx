/**
 * React-side registry of workflow render extensions (RunScreen tabs,
 * OutroScreen sections). Kept separate from `workflow-registry.ts` so
 * tests of the metadata registry don't need to transform `ink` / React.
 *
 * Adding a new workflow with custom tabs / outro sections:
 *   1. Define them in the workflow folder's `extras.tsx`.
 *   2. Map them under the workflow's flowKey here.
 */

import type { ReactNode } from 'react';
import type { WizardSession } from '../wizard-session.js';
import type { WorkflowRunScreenTab } from './workflow-step.js';
import { auditRunScreenTabs, renderAuditOutroSection } from './audit/extras.js';

interface WorkflowRenderers {
  runScreenTabs?: ReadonlyArray<WorkflowRunScreenTab>;
  outroSection?: (session: WizardSession) => ReactNode;
}

const RENDERERS: Record<string, WorkflowRenderers> = {
  audit: {
    runScreenTabs: auditRunScreenTabs,
    outroSection: renderAuditOutroSection,
  },
};

export function getWorkflowRunScreenTabs(
  flowKey: string,
): ReadonlyArray<WorkflowRunScreenTab> {
  return RENDERERS[flowKey]?.runScreenTabs ?? [];
}

export function getWorkflowOutroSection(
  flowKey: string,
  session: WizardSession,
): ReactNode {
  const fn = RENDERERS[flowKey]?.outroSection;
  return fn ? fn(session) : null;
}
