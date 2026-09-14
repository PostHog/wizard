/**
 * The wizard tool vocabulary → pi tool mapping for orchestrator tasks: which
 * pi tools a task's allow list unlocks, which queue tools its disallow list
 * removes, and the names the security fence blocks.
 */
import { describe, it, expect } from 'vitest';
import {
  allowedPiCodingTools,
  allowedOrchestratorTools,
  allowedPiWizardTools,
  fenceDisallowList,
} from '../task';

describe('allowedPiWizardTools', () => {
  const always = ['check_env_keys', 'set_env_values', 'detect_package_manager'];

  it('withholds wizard_ask from a task that did not ask for it', () => {
    const tools = allowedPiWizardTools(['Read', 'Edit']);
    for (const name of always) expect(tools.has(name)).toBe(true);
    expect(tools.has('wizard_ask')).toBe(false);
  });

  it('grants wizard_ask to a task whose prompt allows it', () => {
    expect(allowedPiWizardTools(['Read', 'wizard_ask']).has('wizard_ask')).toBe(
      true,
    );
  });

  it('reads the MCP-qualified name the loader emits', () => {
    expect(
      allowedPiWizardTools(['mcp__wizard-tools__wizard_ask']).has('wizard_ask'),
    ).toBe(true);
  });

  it('withholds wizard_ask when a task states no tools at all', () => {
    expect(allowedPiWizardTools(undefined).has('wizard_ask')).toBe(false);
  });

  it('grants the skill-menu pair only to a task whose prompt allows them', () => {
    const granted = allowedPiWizardTools([
      'Read',
      'load_skill_menu',
      'install_skill',
    ]);
    expect(granted.has('load_skill_menu')).toBe(true);
    expect(granted.has('install_skill')).toBe(true);

    const withheld = allowedPiWizardTools(['Read', 'Edit']);
    expect(withheld.has('load_skill_menu')).toBe(false);
    expect(withheld.has('install_skill')).toBe(false);
  });
});

describe('allowedPiCodingTools', () => {
  it('maps the wizard vocabulary to pi tool names', () => {
    expect(allowedPiCodingTools(['Read', 'Edit', 'Glob', 'Grep'])).toEqual(
      new Set(['read', 'edit', 'find', 'ls', 'grep']),
    );
  });

  it('unlocks bash and write only when allowed', () => {
    const tools = allowedPiCodingTools(['Read', 'Write', 'Bash']);
    expect(tools).toEqual(new Set(['read', 'write', 'bash']));
  });

  it('an empty allow list means every coding tool', () => {
    expect(allowedPiCodingTools([])).toEqual(
      new Set(['read', 'edit', 'write', 'bash', 'find', 'ls', 'grep']),
    );
    expect(allowedPiCodingTools(undefined)).toEqual(
      new Set(['read', 'edit', 'write', 'bash', 'find', 'ls', 'grep']),
    );
  });

  it('ignores names outside the vocabulary (orchestrator tools are not coding tools)', () => {
    expect(
      allowedPiCodingTools(['Read', 'mcp__posthog-wizard__complete_task']),
    ).toEqual(new Set(['read']));
  });
});

describe('allowedOrchestratorTools', () => {
  it('a task agent (enqueue disallowed) keeps complete_task and read_handoffs', () => {
    expect(
      allowedOrchestratorTools(['mcp__posthog-wizard__enqueue_task']),
    ).toEqual(new Set(['complete_task', 'read_handoffs']));
  });

  it('the seed (complete_task disallowed) keeps enqueue_task and read_handoffs', () => {
    expect(
      allowedOrchestratorTools([
        'Write',
        'Edit',
        'Bash',
        'mcp__posthog-wizard__complete_task',
      ]),
    ).toEqual(new Set(['enqueue_task', 'read_handoffs']));
  });

  it('short names disallow too', () => {
    expect(allowedOrchestratorTools(['enqueue_task'])).toEqual(
      new Set(['complete_task', 'read_handoffs']),
    );
  });
});

describe('fenceDisallowList', () => {
  it('carries both the given names and the pi-short orchestrator names', () => {
    expect(
      fenceDisallowList(['Write', 'mcp__posthog-wizard__enqueue_task']),
    ).toEqual(['Write', 'mcp__posthog-wizard__enqueue_task', 'enqueue_task']);
  });

  it('is empty for an empty disallow list', () => {
    expect(fenceDisallowList(undefined)).toEqual([]);
  });
});
