/**
 * A flow is the ordered step list a store walks: which stage of a run is
 * active, which gates the runner awaits, and which step key the TUI renders.
 * The store owns this shape; programs build flows from their step lists.
 */

import type { WizardSession, DiscoveredFeature } from '@lib/wizard-session';
import type { WizardReadinessResult } from '@lib/health-checks/readiness';
import type { Integration } from '@lib/constants';
import type { FrameworkConfig } from '@lib/framework-config';
import type { ProgramId } from '@lib/programs/program-registry';

/** Context passed to onInit callbacks, before the real session is assigned. */
export interface StoreInitContext {
  readonly session: WizardSession;
  readonly setReadinessResult: (result: WizardReadinessResult | null) => void;
  readonly setFrameworkContext: (key: string, value: unknown) => void;
  readonly emitChange: () => void;
}

/** Context passed to onReady callbacks, after the real session is assigned. */
export interface ProgramReadyContext {
  readonly session: WizardSession;
  readonly setFrameworkContext: (key: string, value: unknown) => void;
  readonly setFrameworkConfig: (
    integration: Integration,
    config: FrameworkConfig,
  ) => void;
  readonly setDetectedFramework: (label: string) => void;
  readonly setSkillId: (skillId: string | null) => void;
  readonly setUnsupportedVersion: (info: {
    current: string;
    minimum: string;
    docsUrl: string;
  }) => void;
  readonly addDiscoveredFeature: (feature: DiscoveredFeature) => void;
  readonly setDetectionComplete: () => void;
  readonly setPosthogSdkDetected: (detected: boolean) => void;
}

export interface FlowStep {
  /** Unique identifier for this step */
  id: string;
  /** Human-readable label for progress display */
  label: string;
  /**
   * Opaque screen key this step owns, if any. The TUI maps it to a component;
   * the store only compares it (e.g. 'intro', 'run', 'outro').
   */
  screenId?: string;
  /** Whether this step is visible in the current flow. Omitted = always. */
  show?: (session: WizardSession) => boolean;
  /** Exit condition for the step. Defaults to `gate` if unset. */
  isComplete?: (session: WizardSession) => boolean;
  /** Blocking checkpoint: `store.getGate(stepId)` resolves once this is true. */
  gate?: (session: WizardSession) => boolean;
  /**
   * Called once when the TUI starts rendering, with the default session. Use
   * for session-independent fire-and-forget work. Never fires for a store that
   * isn't rendering screens (tests, playground).
   */
  onInit?: (ctx: StoreInitContext) => void;
  /**
   * Called once after the real session is assigned, before any gate is
   * awaited. Awaited in sequence with other steps' onReady callbacks.
   */
  onReady?: (ctx: ProgramReadyContext) => void | Promise<void>;
  /**
   * Report this step's analytics under a different program than its host, for
   * steps shared across programs. Attribution only. Matched by `screenId`.
   */
  reportsAsProgramId?: ProgramId;
}

export interface Flow {
  programId: ProgramId;
  skillId: string | null;
  steps: FlowStep[];
}
