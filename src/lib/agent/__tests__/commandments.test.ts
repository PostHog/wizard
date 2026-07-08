import { getWizardCommandments } from '@lib/agent/commandments';

describe('getWizardCommandments', () => {
  // The commandment text is load-bearing — the agent reads these rules as
  // part of its system prompt and they steer every program's behavior.
  // Snapshotting makes any edit visible in the PR diff so the change can
  // be reviewed alongside the behavior it affects.
  it('matches the published commandment list', () => {
    expect(getWizardCommandments()).toMatchSnapshot();
  });

  // The two rules below answer the most common end-of-run agent remarks
  // (wizard#793 rollout): "do new files need a prior read?" and "how do I
  // delete .posthog-events.json without rm?". Locked down so a future edit
  // can't silently reintroduce the ambiguity.
  describe('file handling rules', () => {
    const text = getWizardCommandments();

    it('scopes read-before-write to files that already exist', () => {
      expect(text).toMatch(/any file that already exists/i);
    });

    it('exempts brand-new files from the prior read', () => {
      expect(text).toMatch(/brand-new files are the exception/i);
      expect(text).toMatch(/never required first/i);
    });

    it('tells the agent to leave wizard bookkeeping files alone', () => {
      expect(text).toMatch(/\.posthog-events\.json/);
      expect(text).toMatch(/skip that step/i);
      expect(text).toMatch(/host-side after the run/i);
    });
  });

  // Targeted assertions for the wizard_ask Path A translation rules.
  // These are the rules a skill author depends on when leaving their prose
  // unchanged — they need to keep working as the commandment list evolves.
  describe('wizard_ask Path A rules', () => {
    const text = getWizardCommandments();

    it('names the tool explicitly', () => {
      expect(text).toMatch(/`wizard_ask`/);
    });

    it('forbids inlining questions in text output', () => {
      expect(text).toMatch(/never inline questions/i);
    });

    it('requires batching prose lists into one call', () => {
      expect(text).toMatch(/single `wizard_ask` tool call/i);
      expect(text).toMatch(/never split/i);
    });

    it('describes how to infer `kind`', () => {
      expect(text).toMatch(/`single`/);
      expect(text).toMatch(/`multi`/);
      expect(text).toMatch(/`text`/);
    });

    it('describes how to derive options and ids', () => {
      expect(text).toMatch(/kebab-case/i);
      expect(text).toMatch(/label.*value/i);
    });

    it('tells the agent to use answers directly without re-asking', () => {
      expect(text).toMatch(/do not re-ask/i);
    });
  });
});
