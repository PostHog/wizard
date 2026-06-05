import { selectRunner, isOpenCodeRunnerEnabled } from '../index';
import { SdkRunner } from '../sdk-runner';
import { HarnessRunner } from '../harness-runner';
import { WIZARD_OPEN_CODE_RUNNER_FLAG_KEY } from '../../../constants';

// `runAgent` pulls in the full SDK-backed agent stack; runner selection is a
// pure choice over flags, so stub the module to keep this a focused unit test.
jest.mock('../../agent-interface', () => ({
  runAgent: jest.fn(),
  handleSDKMessage: jest.fn(),
  AgentErrorType: {},
}));

describe('isOpenCodeRunnerEnabled', () => {
  it('is true only when the flag is exactly "true"', () => {
    expect(
      isOpenCodeRunnerEnabled({ [WIZARD_OPEN_CODE_RUNNER_FLAG_KEY]: 'true' }),
    ).toBe(true);
    expect(
      isOpenCodeRunnerEnabled({ [WIZARD_OPEN_CODE_RUNNER_FLAG_KEY]: 'false' }),
    ).toBe(false);
    expect(isOpenCodeRunnerEnabled({})).toBe(false);
  });
});

describe('selectRunner', () => {
  it('returns the open-code (harness) runner when the flag is enabled', () => {
    expect(
      selectRunner({ [WIZARD_OPEN_CODE_RUNNER_FLAG_KEY]: 'true' }),
    ).toBeInstanceOf(HarnessRunner);
  });

  it('returns the SDK runner when the flag is disabled', () => {
    expect(
      selectRunner({ [WIZARD_OPEN_CODE_RUNNER_FLAG_KEY]: 'false' }),
    ).toBeInstanceOf(SdkRunner);
  });

  it('defaults to the SDK runner when the flag is absent', () => {
    expect(selectRunner({})).toBeInstanceOf(SdkRunner);
  });

  it('defaults to the SDK runner for a non-boolean value', () => {
    expect(
      selectRunner({ [WIZARD_OPEN_CODE_RUNNER_FLAG_KEY]: 'yes' }),
    ).toBeInstanceOf(SdkRunner);
  });
});
