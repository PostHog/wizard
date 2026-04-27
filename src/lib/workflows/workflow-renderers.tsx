/**
 * React-side registry of workflow render extensions (RunScreen tabs,
 * OutroScreen sections, AgentSkillIntroScreen overrides). Kept separate
 * from `workflow-registry.ts` so tests of the metadata registry don't
 * need to transform `ink` / React.
 *
 * Adding a new workflow with custom tabs / outro sections / intro copy:
 *   1. Define them in the workflow folder's `extras.tsx`.
 *   2. Map them under the workflow's flowKey here.
 */

import type { ReactNode } from 'react';
import type { WizardSession } from '../wizard-session.js';
import type { WorkflowRunScreenTab } from './workflow-step.js';
import {
  auditRunScreenTabs,
  renderAuditOutroSection,
  auditIntro,
} from './audit/extras.js';

/**
 * Per-workflow override for AgentSkillIntroScreen. All fields are
 * optional — anything left out falls back to the generic skill copy.
 */
export interface WorkflowIntro {
  /** Replaces "PostHog Wizard 🦔". */
  title?: string;
  /** Replaces the default "We'll use AI..." subtitle. */
  subtitle?: ReactNode;
  /** Hide the subtitle entirely. Takes precedence over `subtitle`. */
  hideSubtitle?: boolean;
  /** Replaces "Let's run the {skillId} skill." */
  body?: ReactNode;
  /** Extra menu options inserted between Continue and More info. */
  extraMenuOptions?: ReadonlyArray<{ label: string; value: string }>;
  /**
   * Handler for `extraMenuOptions` selections. Return `true` to consume
   * (stay on the intro screen); `false` falls through to the default
   * "completeSetup" behavior.
   */
  onExtraSelect?: (
    value: string,
    session: WizardSession,
  ) => boolean | Promise<boolean>;
}

/** A tab the workflow contributes to RunScreen. Built-in tabs are referenced
 *  by string ID; workflow-custom tabs are inlined as full WorkflowRunScreenTab. */
export type RunScreenTabSpec =
  | 'status'
  | 'event-plan'
  | 'logs'
  | 'hn'
  | WorkflowRunScreenTab;

interface WorkflowRenderers {
  /** Ordered list of tabs to display in RunScreen for this workflow.
   *  When unset, RunScreen uses its default tab stack. */
  runScreenTabs?: ReadonlyArray<RunScreenTabSpec>;
  outroSection?: (session: WizardSession) => ReactNode;
  intro?: WorkflowIntro;
}

const RENDERERS: Record<string, WorkflowRenderers> = {
  audit: {
    runScreenTabs: [...auditRunScreenTabs, 'logs', 'hn'],
    outroSection: renderAuditOutroSection,
    intro: auditIntro,
  },
};

/** Default RunScreen tab stack for workflows that don't declare one. */
const DEFAULT_RUN_SCREEN_TABS: ReadonlyArray<RunScreenTabSpec> = [
  'status',
  'event-plan',
  'logs',
  'hn',
];

export function getWorkflowRunScreenTabs(
  flowKey: string,
): ReadonlyArray<RunScreenTabSpec> {
  return RENDERERS[flowKey]?.runScreenTabs ?? DEFAULT_RUN_SCREEN_TABS;
}

export function getWorkflowOutroSection(
  flowKey: string,
  session: WizardSession,
): ReactNode {
  const fn = RENDERERS[flowKey]?.outroSection;
  return fn ? fn(session) : null;
}

export function getWorkflowIntro(flowKey: string): WorkflowIntro | undefined {
  return RENDERERS[flowKey]?.intro;
}
