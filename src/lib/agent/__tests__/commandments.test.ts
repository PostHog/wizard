import { WIZARD_COMMANDMENTS } from '@lib/agent/commandments';
import { assembleCommandments } from '@lib/agent/runner/switchboard/commandments';
import { Harness, Sequence } from '@lib/constants';

const global = WIZARD_COMMANDMENTS.join('\n');

/** Every axis combination that reaches a runner today. */
const CAPS = { bash: true, posthogMcp: true };
const prompt = (
  harness: Harness,
  sequence: Sequence,
  program = 'posthog-integration',
) => assembleCommandments({ program, sequence, harness, caps: CAPS });

const COMBOS = [
  ['anthropic', Harness.anthropic, Sequence.linear],
  ['anthropic', Harness.anthropic, Sequence.orchestrator],
  ['pi', Harness.pi, Sequence.linear],
  ['pi', Harness.pi, Sequence.orchestrator],
] as const;

describe('commandments by axis', () => {
  // The commandment text is load-bearing — the agent reads these rules as part
  // of its system prompt and they steer every program's behavior. Snapshotting
  // the assembled output per axis combination makes any edit, or any rule
  // silently reaching the wrong kind of run, visible in the PR diff.
  describe.each(COMBOS)('$0 + $2', (_label, harness, sequence) => {
    it('matches the published prompt', () => {
      expect(prompt(harness, sequence)).toMatchSnapshot();
    });
  });

  it('matches the published prompt for a program with its own guidance', () => {
    expect(
      prompt(Harness.pi, Sequence.linear, 'self-driving'),
    ).toMatchSnapshot();
  });

  // The bug this split fixes: task-list rules used to live in the global list,
  // so they reached orchestrator task sessions — which mount no Task tools on
  // either harness — and cost a "no task-management tool was available" remark.
  describe('task-list rules follow the sequence, not the harness', () => {
    it.each([Harness.anthropic, Harness.pi])(
      'reach a linear run on %s',
      (harness) => {
        expect(prompt(harness, Sequence.linear)).toMatch(/`TaskUpdate`/);
      },
    );

    it.each([Harness.anthropic, Harness.pi])(
      'never reach an orchestrator task on %s',
      (harness) => {
        expect(prompt(harness, Sequence.orchestrator)).not.toMatch(
          /TaskUpdate|TaskCreate|Task tools|task list/,
        );
      },
    );

    it('are stated once, not once per source', () => {
      // Previously duplicated: the global list said "create tasks as soon as you
      // understand the work" while pi's runtime notes said "after you load and
      // skim the skill workflow, not before" — both in the same prompt.
      const linear = prompt(Harness.pi, Sequence.linear);
      expect(
        linear.match(/Create the task list once you understand/g),
      ).toHaveLength(1);
      expect(linear.match(/Each task subject is SHORT/g)).toHaveLength(1);
      expect(linear).not.toMatch(/Create tasks as soon as you understand/);
    });

    it('keeps the provider-naming rule global — it governs code, not a tool', () => {
      expect(global).toMatch(/Do not assume "PostHog provider"/);
      expect(prompt(Harness.pi, Sequence.orchestrator)).toMatch(
        /Do not assume "PostHog provider"/,
      );
    });
  });

  describe('axis scoping', () => {
    it('gives every run the global commandments', () => {
      for (const [, harness, sequence] of COMBOS) {
        expect(prompt(harness, sequence)).toContain(WIZARD_COMMANDMENTS[0]);
      }
    });

    it('adds program guidance only for the program that declares it', () => {
      expect(prompt(Harness.pi, Sequence.linear, 'self-driving')).toMatch(
        /custom-scout proposal/,
      );
      expect(prompt(Harness.pi, Sequence.linear)).not.toMatch(
        /custom-scout proposal/,
      );
    });

    it("adds a harness's runtime notes only for that harness", () => {
      expect(prompt(Harness.pi, Sequence.linear)).toMatch(/## This runtime/);
      expect(prompt(Harness.anthropic, Sequence.linear)).not.toMatch(
        /## This runtime/,
      );
    });
  });

  // Targeted assertions for the wizard_ask Path A translation rules.
  // These are the rules a skill author depends on when leaving their prose
  // unchanged — they need to keep working as the commandment list evolves.
  describe('wizard_ask Path A rules', () => {
    const text = global;

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
