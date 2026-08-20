import { describe, expect, it } from 'vitest';

import { resolveSelfDrivingStepKey } from '../step-keys.js';

describe('resolveSelfDrivingStepKey', () => {
  // Every label below is one real runs have emitted. They are the point of the mapping: the agent
  // words its own tasks, so the GitHub step alone has arrived under six spellings.
  it.each([
    ['Connect GitHub', 'connect_github'],
    ['Connecting GitHub', 'connect_github'],
    ['Connect GitHub (required)', 'connect_github'],
    ['Connecting GitHub integration', 'connect_github'],
    ['Connect GitHub integration', 'connect_github'],
    // Reads as an access check, but it is the GitHub step deciding whether to prompt.
    ['Checking GitHub connection', 'connect_github'],
    ['Checking Self-driving access', 'check_access'],
    ['Reading project state', 'read_context'],
    ['Reading project and Self-driving state', 'read_context'],
    ['Enabling products', 'enable_products'],
    ['Enabling signal sources', 'enable_signal_sources'],
    ['Configuring scout troop', 'configure_scouts'],
    ['Designing custom scouts', 'design_custom_scouts'],
    ['Setting up Replay Vision scanners', 'setup_replay_vision'],
    ['Writing the report', 'write_report'],
  ])('maps %j to %j', (label, expected) => {
    expect(resolveSelfDrivingStepKey(label)).toBe(expected);
  });

  // The ordering trap: these all contain "connect", and two mention GitHub's issue tracker. Letting
  // them reach `connect_github` would inflate the GitHub connect funnel with issue-tracker steps.
  it.each([
    'Connecting issue trackers',
    'Connecting issue-tracker integrations',
    'Setting up issue-tracker integrations',
    'Offering issue-tracker integrations',
  ])('keeps %j out of the GitHub step', (label) => {
    expect(resolveSelfDrivingStepKey(label)).toBe('connect_issue_trackers');
  });

  it('leaves an unrecognized step unkeyed rather than bucketing it', () => {
    expect(resolveSelfDrivingStepKey('Polishing the hedgehog')).toBeUndefined();
    expect(resolveSelfDrivingStepKey(undefined)).toBeUndefined();
    expect(resolveSelfDrivingStepKey('')).toBeUndefined();
  });
});
