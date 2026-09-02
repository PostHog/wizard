/**
 * WizardE2eProfile — a program's declarative e2e "test definition": the UI
 * choices a headless e2e run makes at each decision point.
 *
 * Per-program choices live in {@link ./profiles}, keyed by program id.
 * {@link decideE2eAction} maps the current screen + a profile to the commit to
 * make. Add a program's profile to {@link ./profiles} to make it e2e-drivable.
 */

import { ScreenId, Overlay, type ScreenName } from '@ui/tui/router';
import type { AskAnswers, AskQuestion } from '@lib/wizard-session';
import type { CiState } from './wizard-ci-driver.js';

/** Which option to pick for a setup disambiguation question. */
export type SetupChoice = 'first' | 'last';

/** The literal answer used when a profile has nothing better to offer. */
export const E2E_ANSWER_SENTINEL = 'e2e';

/**
 * One routing rule for an agent question.
 *
 * `match` is a case-insensitive regex source string. Every rule is tested
 * against the question `id` first; only if none matches is every rule tested
 * against the `prompt`. Within a pass the first matching rule wins. `value` may
 * carry `${ENV_VAR}` references — `resolveE2eProfile` expands them once, at
 * profile load. See {@link answerQuestions}.
 *
 * `secret` marks a rule whose value is a real credential. The agent controls
 * every field the rule matches on, so an unmarked rule will hand its value to
 * whatever question claims the name — and a question that omits
 * `sensitive: true` gets that value back unvaulted, in plaintext. A `secret`
 * rule therefore answers only a `kind: 'text'` question with `sensitive: true`,
 * and refuses the question outright otherwise. Set it on any rule pointed at an
 * API key or a password; leave it off for hostnames, ports and prefixes, which
 * a skill has no reason to flag sensitive.
 */
export interface AskAnswerRule {
  match: string;
  value: string;
  secret?: boolean;
}

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
  /** Answer strategy for an agent `wizard_ask` overlay: the first option (its
   * affirmative "continue" — e.g. self-driving's "GitHub connected → done"). */
  ask: 'first';
  /**
   * Self-driving integration-check answer: `true` → "no, set it up first"
   * (integrate the SDK as part of the run); `false` → "yes, already
   * integrated". Only read on the integration-check screen.
   */
  integrate?: boolean;
  /**
   * Task-notice overlay: `keep` runs the optional step the notice covers,
   * `decline` skips it. The workbench flips this per run variation through
   * `E2E_NOTICE` — see {@link ./profiles resolveE2eProfile}.
   */
  notice?: 'keep' | 'decline';
  /**
   * Per-question answer routing for `wizard_ask`, ahead of the `ask` strategy.
   * Lets a program point a credential question at an env var instead of taking
   * a useless first option or the sentinel.
   */
  askAnswers?: AskAnswerRule[];
}

/** Happy-path default: take every screen forward, leave nothing behind. */
export const DEFAULT_E2E_PROFILE: WizardE2eProfile = {
  setup: 'first',
  healthCheck: 'dismiss',
  mcp: 'skip',
  slack: 'skip',
  skills: 'delete',
  ask: 'first',
  integrate: false,
  notice: 'keep',
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

/**
 * What a decision did, for the host's run log.
 *
 * The host records *that* an ask or a notice happened by watching the store,
 * but only the decision function knows how it resolved each one. This is that
 * report back. It carries question ids and a keep/decline verdict — never an
 * answer value, so nothing derived from it can leak a credential into the
 * result payload.
 */
export type E2eDecisionReport =
  | {
      kind: 'ask';
      /** PendingQuestion.id of the batch this reports on. */
      id: string;
      /** Question ids the profile produced a real answer for. */
      answeredIds: string[];
      /** Question ids that fell back to the `'e2e'` sentinel. */
      sentinelIds: string[];
      /**
       * Question ids a `secret` rule refused — the question claimed a
       * credential field but was not a sensitive text question. Disjoint from
       * the other two.
       */
      refusedIds: string[];
    }
  | { kind: 'notice'; title: string; decision: 'keep' | 'decline' };

/** What the harness should do for the current screen. */
export interface E2eDecision {
  /** A driver action to commit, if any. */
  action?: { id: string; params?: Record<string, unknown> };
  /** What this decision resolved, when it resolved an ask or a notice. */
  report?: E2eDecisionReport;
  /** Set on the keep-skills screen — the orchestrator does the fs deletion. */
  skillsPolicy?: 'keep' | 'delete';
  /** True once the terminal commit has been made. */
  done?: boolean;
  /** No action — wait for an external transition (probe, auth, agent run). */
  wait?: boolean;
}

/** The answers for one `wizard_ask` batch, plus which ids fell back. */
export interface AnsweredBatch {
  answers: AskAnswers;
  answeredIds: string[];
  sentinelIds: string[];
  /** Ids a `secret` rule refused to answer. See {@link AskAnswerRule}. */
  refusedIds: string[];
}

/**
 * Answer every question in one `wizard_ask` batch.
 *
 * Resolution order per question:
 *   1. the first `askAnswers` rule matching the id, else the first matching
 *      the prompt;
 *   2. the first option, for `single` and `multi` questions;
 *   3. the literal `'e2e'` sentinel.
 *
 * A rule that resolves to an empty string (its `${ENV_VAR}` was unset) counts
 * as no match, so the question falls through to the next step. For a `text`
 * credential question — one with no options — that lands on the sentinel, which
 * is what the workbench reads to say "this run answered nothing here".
 *
 * A `secret` rule matching a question that is not sensitive free text refuses
 * it: the answer is the sentinel and the id lands in `refusedIds` rather than
 * falling through to an option. The skill names its own questions, so without
 * that rail a question called `stripe` could take a credential and — by leaving
 * `sensitive` off — get it back in plaintext instead of a vault ref.
 *
 * `multi` questions always get an array answer, as the ask bridge expects.
 * Pure: rule values arrive already interpolated (see `resolveE2eProfile`).
 */
export function answerQuestions(
  questions: readonly AskQuestion[],
  profile: WizardE2eProfile,
): AnsweredBatch {
  const rules = profile.askAnswers ?? [];
  const answers: AskAnswers = {};
  const answeredIds: string[] = [];
  const sentinelIds: string[] = [];
  const refusedIds: string[] = [];

  for (const q of questions) {
    const routed = matchRule(q, rules);
    if (routed?.refused) {
      answers[q.id] =
        q.kind === 'multi' ? [E2E_ANSWER_SENTINEL] : E2E_ANSWER_SENTINEL;
      refusedIds.push(q.id);
      continue;
    }
    const value = routed?.value ?? q.options?.[0]?.value ?? E2E_ANSWER_SENTINEL;
    const isSentinel = !routed && q.options?.[0] === undefined;
    answers[q.id] = q.kind === 'multi' ? [value] : value;
    (isSentinel ? sentinelIds : answeredIds).push(q.id);
  }

  return { answers, answeredIds, sentinelIds, refusedIds };
}

/** What a rule pass produced: a value, a refusal, or nothing. */
type RuleMatch = { value: string; refused?: false } | { refused: true };

/**
 * The value routed to a question, or null when no rule routes it.
 *
 * Two passes: every rule against the question `id`, then every rule against the
 * `prompt`. The id is the field the skill controls, so an id match is the
 * stronger signal — a rule aimed at `host` must not claim the `port` question
 * just because the prompt happens to say "host and port".
 *
 * A matching `secret` rule yields its value only for a sensitive text question;
 * any other question shape gets a refusal, never the value.
 */
function matchRule(
  question: AskQuestion,
  rules: readonly AskAnswerRule[],
): RuleMatch | null {
  for (const field of [question.id, question.prompt]) {
    for (const rule of rules) {
      let re: RegExp;
      try {
        re = new RegExp(rule.match, 'i');
      } catch {
        continue; // a malformed profile regex must not break the whole run
      }
      if (!re.test(field)) continue;
      // An unset `${ENV_VAR}` leaves nothing to route and nothing to withhold,
      // so the rule is inert — the question takes the normal fallback.
      if (rule.value === '') return null;
      if (rule.secret && !acceptsSecret(question)) return { refused: true };
      return { value: rule.value };
    }
  }
  return null;
}

/**
 * Whether a question may receive a `secret` rule's value: free text the skill
 * flagged sensitive, so `wizard_ask` vaults the answer and hands the agent a
 * ref instead of the credential.
 */
function acceptsSecret(question: AskQuestion): boolean {
  return question.kind === 'text' && question.sensitive === true;
}

/**
 * Map the current screen + profile to the commit to make. Pure: no store, no
 * fs, and no `process.env` — the caller applies the returned action via the
 * driver and handles `skillsPolicy` itself. Returns `{ wait: true }` for
 * screens the runner/agent advances on their own (auth, run, ai-opt-in, a
 * clean health probe).
 *
 * Env-var inputs (`E2E_NOTICE`, `${...}` inside `askAnswers`) are folded into
 * the profile once, at load, by `resolveE2eProfile` in `./profiles`. Reading
 * `process.env` here would make the same (state, profile) pair return different
 * decisions in different processes, and the flow-snapshot test depends on it
 * not doing that.
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
    case ScreenId.MetricsIntro:
    case ScreenId.ErrorTrackingIntro:
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

    case ScreenId.SelfDrivingIntegrationCheck:
      return {
        action: {
          id: 'set_integrate',
          params: { integrate: profile.integrate === true },
        },
      };

    case ScreenId.SelfDrivingHandoff:
      return { action: { id: 'confirm_self_driving_handoff' } };

    case ScreenId.Outro:
    case ScreenId.SourceMapsOutro:
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
      const pending = state.pendingQuestion;
      if (!pending || pending.questions.length === 0) return { wait: true };
      // Answer the whole batch. The bridge resolves on one answers map, so a
      // partial map would leave the unanswered fields empty for the agent.
      const batch = answerQuestions(pending.questions, profile);
      return {
        action: {
          id: 'answer_question',
          params: { answers: batch.answers },
        },
        report: {
          kind: 'ask',
          id: pending.id,
          answeredIds: batch.answeredIds,
          sentinelIds: batch.sentinelIds,
          refusedIds: batch.refusedIds,
        },
      };
    }

    case Overlay.TaskNotice: {
      const notice = state.taskNotice;
      if (!notice) return { wait: true };
      const keep = profile.notice !== 'decline';
      return {
        action: { id: 'resolve_notice', params: { keep } },
        report: {
          kind: 'notice',
          title: notice.title,
          decision: keep ? 'keep' : 'decline',
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
  ScreenId.SelfDrivingIntegrationCheck,
  ScreenId.Outro,
  ScreenId.SourceMapsOutro,
  ScreenId.Mcp,
  ScreenId.McpSuggestedPrompts,
  ScreenId.SlackConnect,
  ScreenId.KeepSkills,
  Overlay.WizardAsk,
  Overlay.TaskNotice,
];
