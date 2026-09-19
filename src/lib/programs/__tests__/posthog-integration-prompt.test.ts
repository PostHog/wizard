/**
 * The default integration prompt's skill-workflow instructions.
 *
 * STEP 1 scopes the linear agent to exactly three skill categories: the
 * framework skill first, then AI Observability and Logs when its workflow
 * calls for them. These tests pin that scoping — the allowlist, the delegation
 * to the skill's workflow, and the hard guard against every other category.
 */

import { promptFor } from './helpers/integration-prompt';

describe('default integration skill workflow', () => {
  it('loads the framework category first and delegates observability to its workflow', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toContain('category: "integration"');
    expect(prompt).toContain('AI Observability and Logs skills');
    expect(prompt).toContain('before verification and the setup report');
  });

  it('forbids every category outside the three the run uses', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toContain(
      'Do NOT load or install skills from any other category',
    );
    expect(prompt).toContain('do not substitute `llm-analytics`');
  });
});
