import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkAllExternalServices,
  evaluateWizardReadiness,
  getBlockingServiceKeys,
  WizardReadiness,
} from '../readiness';
import { checkLlmGatewayHealth, checkSkillsOriginHealth } from '../endpoints';
import { ServiceHealthStatus, type AllServicesHealth } from '../types';

vi.mock('../endpoints', () => ({
  checkLlmGatewayHealth: vi.fn(),
  checkSkillsOriginHealth: vi.fn(),
}));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));

const healthy = { status: ServiceHealthStatus.Healthy };
const down = { status: ServiceHealthStatus.Down };
const unreachable = { status: ServiceHealthStatus.NoConnection };
const gatewayUrl = 'https://ai-gateway.eu.posthog.com';

describe('Wizard dependency health', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(checkLlmGatewayHealth).mockReset().mockResolvedValue(healthy);
    vi.mocked(checkSkillsOriginHealth).mockReset().mockResolvedValue(healthy);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks skills before auth without guessing a gateway or reporting a warning', async () => {
    const result = await evaluateWizardReadiness();
    expect(result).toEqual({
      decision: WizardReadiness.Yes,
      health: { skillsOrigin: healthy },
      reasons: [],
    });
    expect(checkSkillsOriginHealth).toHaveBeenCalledOnce();
    expect(checkLlmGatewayHealth).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the supplied gateway and skills targets', async () => {
    const health = await checkAllExternalServices({
      gatewayUrl: 'http://localhost:8080',
      skillsBaseUrl: 'http://localhost:8765',
    });
    expect(checkLlmGatewayHealth).toHaveBeenCalledWith('http://localhost:8080');
    expect(checkSkillsOriginHealth).toHaveBeenCalledWith(
      'http://localhost:8765',
    );
    expect(health).toEqual({ llmGateway: healthy, skillsOrigin: healthy });
  });

  it('checks the minted gateway even when skills health was cached before auth', async () => {
    vi.mocked(checkLlmGatewayHealth).mockResolvedValue(down);
    const result = await evaluateWizardReadiness({
      gatewayUrl,
      skillsHealth: healthy,
    });
    expect(checkLlmGatewayHealth).toHaveBeenCalledWith(gatewayUrl);
    expect(checkSkillsOriginHealth).not.toHaveBeenCalled();
    expect(result.decision).toBe(WizardReadiness.No);
    expect(getBlockingServiceKeys(result.health)).toEqual(['llmGateway']);
  });

  it.each([
    [healthy, healthy, []],
    [down, healthy, ['llmGateway']],
    [unreachable, healthy, ['llmGateway']],
    [healthy, down, ['skillsOrigin']],
    [healthy, unreachable, ['skillsOrigin']],
    [down, down, ['llmGateway', 'skillsOrigin']],
    [unreachable, unreachable, ['llmGateway', 'skillsOrigin']],
  ])(
    'only interrupts for failed runtime dependencies (%j, %j)',
    async (gateway, skills, blocked) => {
      vi.mocked(checkLlmGatewayHealth).mockResolvedValue(gateway);
      vi.mocked(checkSkillsOriginHealth).mockResolvedValue(skills);
      const result = await evaluateWizardReadiness({ gatewayUrl });
      expect(getBlockingServiceKeys(result.health)).toEqual(blocked);
      expect(result.decision).toBe(
        blocked.length ? WizardReadiness.No : WizardReadiness.Yes,
      );
    },
  );

  it('does not turn a one-origin fallback into warnings or outage reasons', async () => {
    vi.mocked(checkSkillsOriginHealth).mockResolvedValue({
      ...healthy,
      rawIndicator: 'HTTP 200 (via aws, github unavailable)',
    });
    const result = await evaluateWizardReadiness({ gatewayUrl });
    expect(result.decision).toBe(WizardReadiness.Yes);
    expect(result.reasons).toEqual([]);
  });

  it('ignores obsolete provider and status-page results even in a stale health object', () => {
    const stale: AllServicesHealth & Record<string, unknown> = {
      skillsOrigin: healthy,
      llmGateway: healthy,
      anthropic: down,
      posthogOverall: down,
      posthogComponents: down,
      github: down,
      npmOverall: down,
      npmComponents: down,
      cloudflareOverall: down,
      cloudflareComponents: down,
      mcp: down,
    };
    expect(getBlockingServiceKeys(stale)).toEqual([]);
  });

  it('does not include internal gateway diagnostics in outage reasons', async () => {
    vi.mocked(checkLlmGatewayHealth).mockResolvedValue({
      ...down,
      error: 'private dependency detail',
    });
    const result = await evaluateWizardReadiness({ gatewayUrl });
    expect(result.reasons).toEqual(['LLM gateway: down']);
  });

  it('clears the watchdog after an unexpected failure and proceeds without warnings', async () => {
    vi.mocked(checkSkillsOriginHealth).mockRejectedValue(
      new Error('unexpected'),
    );
    const result = await evaluateWizardReadiness();
    expect(result.decision).toBe(WizardReadiness.Yes);
    expect(result.reasons).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not claim an outage when a check cannot finish', async () => {
    vi.mocked(checkSkillsOriginHealth).mockReturnValue(
      new Promise(() => {
        // Deliberately never settles; the readiness watchdog must release the run.
      }),
    );
    const pending = evaluateWizardReadiness();
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result.decision).toBe(WizardReadiness.Yes);
    expect(result.reasons).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
