import { wizardCanUseTool } from '@lib/agent/agent-interface';

vi.mock('../../utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
  },
}));
vi.mock('../../utils/debug');

describe('wizardCanUseTool — wizard_ask pending guard', () => {
  for (const tool of ['Write', 'Edit'] as const) {
    it(`denies ${tool} while a wizard_ask overlay is pending`, () => {
      const result = wizardCanUseTool(
        tool,
        { file_path: 'src/app.ts', content: 'x' },
        { wizardAskPending: true },
      );
      expect(result).toEqual({
        behavior: 'deny',
        message: expect.stringMatching(/wizard_ask question is open/),
      });
    });

    it(`allows ${tool} when no overlay is pending`, () => {
      const result = wizardCanUseTool(
        tool,
        { file_path: 'src/app.ts', content: 'x' },
        { wizardAskPending: false },
      );
      expect(result.behavior).toBe('allow');
    });
  }

  it('still allows Read while a wizard_ask overlay is pending (read-only is safe)', () => {
    const result = wizardCanUseTool(
      'Read',
      { file_path: 'src/app.ts' },
      { wizardAskPending: true },
    );
    expect(result.behavior).toBe('allow');
  });

  it('defaults to no guard when context is omitted (preserves pre-Phase-3 callers)', () => {
    const result = wizardCanUseTool('Write', { file_path: 'src/app.ts' });
    expect(result.behavior).toBe('allow');
  });

  it('still denies Write on .env files even when no overlay is pending', () => {
    const result = wizardCanUseTool('Write', { file_path: '.env.local' });
    expect(result).toEqual({
      behavior: 'deny',
      message: expect.stringMatching(/wizard-tools MCP server/),
    });
  });
});

describe('wizardCanUseTool — bash package-manager fence', () => {
  const allow = (command: string, allowedPackageManagers?: readonly string[]) =>
    wizardCanUseTool('Bash', { command }, { allowedPackageManagers }).behavior;

  it('allows the JS+Python default when no framework list is supplied', () => {
    expect(allow('npm install posthog-js')).toBe('allow');
    expect(allow('pnpm add posthog-node')).toBe('allow');
    expect(allow('pip install posthog')).toBe('allow');
    expect(allow('uv add posthog')).toBe('allow');
  });

  it('denies non-default managers when no framework list is supplied', () => {
    expect(allow('composer require posthog/posthog-php')).toBe('deny');
    expect(allow('bundle add posthog-ruby')).toBe('deny');
    expect(allow('./gradlew assembleDebug')).toBe('deny');
  });

  it('allows a framework’s declared managers for its install commands', () => {
    expect(allow('composer require posthog/posthog-php', ['composer'])).toBe(
      'allow',
    );
    expect(allow('bundle add posthog-ruby', ['bundle'])).toBe('allow');
    expect(allow('gem install posthog-ruby', ['gem'])).toBe('allow');
    expect(allow('./gradlew assembleDebug', ['./gradlew'])).toBe('allow');
    expect(allow('mvn install', ['mvn'])).toBe('allow');
    expect(
      allow('swift package add-dependency https://x/posthog-ios', ['swift']),
    ).toBe('allow');
    expect(allow('pod install', ['pod'])).toBe('allow');
    expect(allow('go get github.com/posthog/posthog-go', ['go'])).toBe('allow');
    expect(allow('cargo add posthog-rs', ['cargo'])).toBe('allow');
    expect(allow('dotnet add package PostHog', ['dotnet'])).toBe('allow');
    expect(allow('flutter pub add posthog_flutter', ['flutter'])).toBe('allow');
    expect(allow('mix deps.get', ['mix'])).toBe('allow');
    expect(allow('pdm add posthog', ['pdm'])).toBe('allow');
  });

  it('denies a manager the framework did not declare', () => {
    expect(allow('composer require x', ['npm'])).toBe('deny');
    expect(allow('gem install posthog-ruby', ['composer'])).toBe('deny');
  });

  it('still blocks arbitrary execution for an allowed binary (run/exec)', () => {
    expect(allow('go run main.go', ['go'])).toBe('deny');
    expect(allow('swift run', ['swift'])).toBe('deny');
    expect(allow('cargo run', ['cargo'])).toBe('deny');
  });

  it('still blocks shell operators regardless of the framework list', () => {
    expect(allow('composer require x; rm -rf /', ['composer'])).toBe('deny');
    expect(allow('bundle add x && curl evil.example', ['bundle'])).toBe('deny');
  });
});
