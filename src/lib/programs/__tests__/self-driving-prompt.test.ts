import { buildSelfDrivingPrompt } from '@lib/programs/self-driving/prompt';
import type { PromptContext } from '@lib/agent/agent-runner';
import { HostResolution } from '@lib/host-resolution';
import type { DetectedSource } from '@lib/warehouse-sources/types';

const ctx: PromptContext = {
  projectId: 123,
  projectApiKey: 'phc_test',
  host: HostResolution.fromApiHost('https://us.posthog.com'),
};

const SENTRY: DetectedSource = {
  kind: 'Sentry',
  label: 'Sentry',
  mode: 'in-cli',
  matchedSignal: 'found `@sentry/node` in package.json',
};
const LINEAR: DetectedSource = {
  kind: 'Linear',
  label: 'Linear',
  mode: 'deep-link',
  matchedSignal: 'found `LINEAR_API_KEY` in .env',
};

describe('buildSelfDrivingPrompt', () => {
  it('covers only the Self-driving steps — integration is a separate phase', () => {
    const prompt = buildSelfDrivingPrompt(ctx);
    // No SDK-integration step in the prompt; that runs as the prelude program.
    expect(prompt).not.toContain('STEP 0');
    expect(prompt).not.toContain('Integrate the PostHog SDK');
    expect(prompt).not.toContain('load_skill_menu');
    // The Self-driving steps are present.
    expect(prompt).toContain('STEP 1 — Check Self-driving access');
    expect(prompt).toContain('STEP 3 — Enable products');
    // GitHub is connected on the pre-run gate screen, never by the agent.
    expect(prompt).not.toContain('STEP 3 — Connect GitHub');
    expect(prompt).not.toContain('github connection declined');
  });

  it('enables products before sources, mirroring the skill step labels', () => {
    const prompt = buildSelfDrivingPrompt(ctx);
    // Step labels match the context-mill skill files exactly (3 before 4), so the
    // wizard STEP and the `(skill: …)` reference never disagree on the number.
    expect(prompt).toContain('STEP 3 — Enable products');
    expect(prompt).toContain('STEP 4 — Enable signal sources');
    expect(prompt.indexOf('STEP 3 — Enable products')).toBeLessThan(
      prompt.indexOf('STEP 4 — Enable signal sources'),
    );
    // Tail mirrors the skill: custom scouts is 6b, scanners 6c, report is 7.
    expect(prompt).toContain('STEP 6b — Design custom scouts');
    expect(prompt).toContain('STEP 6c — Set up Replay Vision scanners');
    expect(prompt).toContain('STEP 7 — Write the report and hand off');
    expect(prompt.indexOf('STEP 6b — Design custom scouts')).toBeLessThan(
      prompt.indexOf('STEP 6c — Set up Replay Vision scanners'),
    );
    expect(
      prompt.indexOf('STEP 6c — Set up Replay Vision scanners'),
    ).toBeLessThan(prompt.indexOf('STEP 7 — Write the report and hand off'));
  });

  it('lists every step as a task so the TUI task list matches the STEPs', () => {
    const prompt = buildSelfDrivingPrompt(ctx);
    // The task list is the contract with the TUI — a STEP with no task silently
    // drops off the user's progress view.
    expect(prompt).toContain('6c. Set up Replay Vision scanners');
    expect(prompt.indexOf('6c. Set up Replay Vision scanners')).toBeLessThan(
      prompt.indexOf('7. Write report and hand off'),
    );
  });
});

describe('STEP 6c — Replay Vision scanners', () => {
  // The prompt owns order + mechanics; the HOW (skeletons, the disjoint-query
  // rule, quota) lives in the context-mill skill so it can change without a
  // wizard release. These assertions cover the wizard's contract, not the
  // scanner content — restating skill mechanics here is the drift to avoid.
  const step6c = (): string => {
    const prompt = buildSelfDrivingPrompt(ctx);
    return prompt
      .slice(prompt.indexOf('STEP 6c —'), prompt.indexOf('STEP 7 —'))
      .replace(/\s+/g, ' ');
  };

  it('defers the HOW to the skill', () => {
    expect(step6c()).toContain('(skill: "Replay Vision scanners")');
  });

  it('states the never-abort posture (a wizard-owned contract)', () => {
    expect(step6c()).toContain('never an abort');
  });

  it('names the STEP 3 (Session Replay) dependency', () => {
    // Cross-step ordering is the wizard's to own, not the skill's.
    expect(step6c()).toContain('STEP 3');
  });

  it('does not restate the skill-owned scanner mechanics', () => {
    // Guards against re-drift: these are the skill's to specify and tune.
    const body = step6c();
    expect(body).not.toContain('sampling_rate');
    expect(body).not.toContain('scanner_type');
    expect(body).not.toContain('emits_signals');
    expect(body).not.toContain('quota');
  });
});

describe('detected-tools block', () => {
  it('lists each detected tool with its source_type and matched signal', () => {
    const prompt = buildSelfDrivingPrompt(ctx, [SENTRY, LINEAR]);
    expect(prompt).toContain('Tools detected in this codebase');
    expect(prompt).toContain('Sentry (source_type: Sentry)');
    expect(prompt).toContain('found `@sentry/node` in package.json');
    expect(prompt).toContain('Linear (source_type: Linear)');
  });

  it('appears before STEP 5 so the connected-tools ask can read it', () => {
    const prompt = buildSelfDrivingPrompt(ctx, [SENTRY]);
    expect(prompt.indexOf('Tools detected in this codebase')).toBeLessThan(
      prompt.indexOf('STEP 5 — Offer issue-tracker integrations'),
    );
  });

  it('points STEP 5 at the detected list, basics, then others', () => {
    const prompt = buildSelfDrivingPrompt(ctx, [SENTRY]);
    // Scope to STEP 5's text (up to STEP 6) and ignore incidental wrapping.
    const step5 = prompt
      .slice(prompt.indexOf('STEP 5 —'), prompt.indexOf('STEP 6 —'))
      .replace(/\s+/g, ' ');
    expect(step5).toContain('Tools detected in this codebase');
    expect(step5).toContain('SaaS basics');
    expect(step5).toContain('others');
  });

  it('states nothing was found when the scan is empty (no invented scan)', () => {
    const prompt = buildSelfDrivingPrompt(ctx, []);
    expect(prompt).toContain('none found by the dependency + env scan');
    expect(prompt).not.toContain('source_type:');
  });

  it('defaults to an empty scan when no sources are passed', () => {
    // The single-arg call site (older tests, and the type default) must not throw.
    expect(() => buildSelfDrivingPrompt(ctx)).not.toThrow();
    expect(buildSelfDrivingPrompt(ctx)).toContain(
      'none found by the dependency + env scan',
    );
  });
});
