import { getWizardCommandments } from '@lib/agent/commandments';

describe('getWizardCommandments', () => {
  // The commandment text is load-bearing — the agent reads these rules as
  // part of its system prompt and they steer every program's behavior.
  // Snapshotting makes any edit visible in the PR diff so the change can
  // be reviewed alongside the behavior it affects.
  it('matches the published commandment list', () => {
    expect(getWizardCommandments()).toMatchSnapshot();
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

  // Orchestrator task-mode sessions (pi/task.ts) never register the
  // TaskCreate/TaskUpdate todo tool, so they must not be told to drive it.
  describe('taskTracking option', () => {
    it('includes the TaskUpdate commandment by default', () => {
      expect(getWizardCommandments()).toMatch(/Drive the work with TaskUpdate/);
    });

    it('omits the TaskUpdate commandment when taskTracking is false', () => {
      expect(getWizardCommandments({ taskTracking: false })).not.toMatch(
        /Drive the work with TaskUpdate/,
      );
    });

    it('leaves other commandments intact when taskTracking is false', () => {
      const text = getWizardCommandments({ taskTracking: false });
      expect(text).toMatch(/Do not spawn subagents/);
      expect(text).toMatch(/Keep task titles broad and stage-oriented/);
    });
  });
});
