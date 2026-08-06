/**
 * WizardE2eProfile — a program's declarative e2e "test definition": the UI
 * choices a headless e2e run makes at each decision point.
 *
 * Per-program choices live in {@link ./profiles}, keyed by program id.
 * {@link decideE2eAction} maps the current screen + a profile to the commit to
 * make. Add a program's profile to {@link ./profiles} to make it e2e-drivable.
 */

import { ScreenId, Overlay, type ScreenName } from '@ui/tui/router';
import type { CiState } from './wizard-ci-driver.js';

/** Which option to pick for a setup disambiguation question. */
export type SetupChoice = 'first' | 'last';

export interface WizardE2eProfile {
  /** Setup disambiguation (e.g. Next.js router): which option to commit. */
  setup: SetupChoice;
  /**
   * Health-check screen: `dismiss` continues even if the probe flags an
   * outage (sets outageDismissed); `wait` lets only a clean probe through.
   */
  healthCheck: 'dismiss' | 'wait';
  /** Post-agent MCP-install step. */
  mcp: 'skip' | 'install';
  /** Connect-Slack step. */
  slack: 'skip';
  /** Keep or delete the wizard-installed skills at the end. */
  skills: 'keep' | 'delete';
  /** Default answer strategy for an agent `wizard_ask` overlay. */
  ask: 'first';
}

/** Happy-path default: take every screen forward, leave nothing behind. */
export const DEFAULT_E2E_PROFILE: WizardE2eProfile = {
  setup: 'first',
  healthCheck: 'dismiss',
  mcp: 'skip',
  slack: 'skip',
  skills: 'delete',
  ask: 'first',
};

/**
 * A switchboard configuration to snapshot for a program — the same `profile`/
 * `path` run once per variation. Omitted fields fall back to the resolved
 * default (linear / anthropic / sonnet), so `{ name: 'default' }` is the
 * no-override baseline. The harness maps each field to its `--harness` /
 * `--sequence` / `--model` override.
 */
export interface WizardE2eVariation {
  /** Snapshot id, e.g. `pi-openai-linear`. */
  name: string;
  summary?: string;
  harness?: 'anthropic' | 'pi';
  sequence?: 'linear' | 'orchestrator';
  /** Gateway model id, e.g. `openai/gpt-5`. */
  model?: string;
}

/** The baseline variation when a program declares none: no overrides. */
export const DEFAULT_E2E_VARIATION: WizardE2eVariation = {
  name: 'default',
  summary: 'linear / anthropic / sonnet — parity with main',
};

/** What the harness should do for the current screen. */
export interface E2eDecision {
  /** A driver action to commit, if any. */
  action?: { id: string; params?: Record<string, unknown> };
  /** Set on the keep-skills screen — the orchestrator does the fs deletion. */
  skillsPolicy?: 'keep' | 'delete';
  /** True once the terminal commit has been made. */
  done?: boolean;
  /** No action — wait for an external transition (probe, auth, agent run). */
  wait?: boolean;
}

/**
 * Map the current screen + profile to the commit to make. Pure: no store, no
 * fs — the caller applies the returned action via the driver and handles
 * `skillsPolicy` itself. Returns `{ wait: true }` for screens the runner/agent
 * advances on their own (auth, run, ai-opt-in, a clean health probe).
 */
export function decideE2eAction(
  state: CiState,
  profile: WizardE2eProfile,
): E2eDecision {
  switch (state.currentScreen) {
    case ScreenId.Intro:
    case ScreenId.RevenueIntro:
    case ScreenId.MigrationIntro:
    case ScreenId.AgentSkillIntro:
    case ScreenId.AiObservabilityIntro:
    case ScreenId.AuditIntro:
    case ScreenId.SourceMapsIntro:
    case ScreenId.DoctorIntro:
    case ScreenId.WarehouseIntro:
    case ScreenId.SelfDrivingIntro:
      return { action: { id: 'confirm_setup' } };

    case ScreenId.HealthCheck:
      return profile.healthCheck === 'dismiss'
        ? { action: { id: 'dismiss_outage' } }
        : { wait: true };

    case ScreenId.Setup: {
      const q = state.setupQuestions[0];
      if (!q) return { wait: true };
      const opt =
        profile.setup === 'last'
          ? q.options[q.options.length - 1]
          : q.options[0];
      return {
        action: { id: 'choose', params: { key: q.key, value: opt.value } },
      };
    }

    case ScreenId.Outro:
      return { action: { id: 'dismiss_outro' } };

    case ScreenId.Mcp:
      return {
        action: {
          id: 'set_mcp_outcome',
          params: {
            outcome: profile.mcp === 'install' ? 'installed' : 'skipped',
          },
        },
      };

    case ScreenId.McpSuggestedPrompts:
      return { action: { id: 'dismiss' } };

    case ScreenId.SlackConnect:
      return { action: { id: 'dismiss_slack' } };

    case ScreenId.KeepSkills:
      return {
        action: {
          id: 'keep_skills',
          params: { kept: profile.skills === 'keep' },
        },
        skillsPolicy: profile.skills,
        done: true,
      };

    case Overlay.WizardAsk: {
      const q = state.pendingQuestion?.questions[0];
      if (!q) return { wait: true };
      // 'first': first option for single/multi, sentinel for free text.
      const answer = q.options?.[0]?.value ?? 'e2e';
      return {
        action: {
          id: 'answer_question',
          params: { answers: { [q.id]: answer } },
        },
      };
    }

    // auth (runner), run (agent), ai-opt-in (ci), exit, terminal overlays.
    default:
      return { wait: true };
  }
}

/** Screens this profile knows how to act on — for completeness checks/tests. */
export const E2E_DRIVABLE_SCREENS: readonly ScreenName[] = [
  ScreenId.Intro,
  ScreenId.HealthCheck,
  ScreenId.Setup,
  ScreenId.Outro,
  ScreenId.Mcp,
  ScreenId.McpSuggestedPrompts,
  ScreenId.SlackConnect,
  ScreenId.KeepSkills,
  Overlay.WizardAsk,
];
