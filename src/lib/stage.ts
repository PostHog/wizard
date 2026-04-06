import type { WizardSession } from './wizard-session';

/**
 * A workflow step is the primary unit of the wizard's execution model.
 *
 * It can own:
 * - a screen in the TUI (optional — some steps are headless)
 * - agent work via a workflow reference (optional — some steps are UI-only)
 * - local state needs (selectors it depends on)
 * - completion and visibility predicates
 *
 * The current PostHog integration flow is one ordered list of steps.
 * Future flows (e.g. feature-flag builder) register a different step list.
 */
export interface WorkflowStep {
  /** Unique identifier for this step */
  id: string;

  /**
   * TUI screen this step owns, if any.
   * Matches the Screen enum values (e.g. 'intro', 'run', 'outro').
   */
  screen?: string;

  /**
   * Whether this step should be visible in the current flow.
   * If omitted, the step is always visible.
   */
  show?: (session: WizardSession) => boolean;

  /**
   * Whether this step is complete.
   * The flow engine advances past complete steps.
   */
  isComplete?: (session: WizardSession) => boolean;

  /**
   * Workflow reference filename this step executes, if any.
   * When set, the runner issues a continued query for this reference.
   * e.g. "basic-integration-1.0-begin.md"
   */
  workflowReference?: string;

  /**
   * Whether this step blocks downstream code via a gate promise.
   * e.g. "setup" and "health-check" gate bin.ts before runWizard().
   */
  gate?: 'setup' | 'health';

  /**
   * Hook called when the step becomes active.
   */
  onEnter?: () => void;

  /**
   * Hook called when the step completes.
   */
  onComplete?: () => void;
}

/**
 * An ordered list of workflow steps that defines a wizard flow.
 * The first flow is the current PostHog integration.
 * Future flows register different step lists.
 */
export type Workflow = WorkflowStep[];
