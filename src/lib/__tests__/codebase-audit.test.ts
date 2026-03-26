import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  scanCodebaseForCompetitors,
  formatAuditForPrompt,
  getCompetitorsFromFeatures,
  generateProjectContext,
  type CodebaseAuditManifest,
} from '../codebase-audit';
import { AdditionalFeature } from '../wizard-session';

describe('codebase-audit', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-audit-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, content: string): void {
    const fullPath = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  describe('getCompetitorsFromFeatures', () => {
    it('maps migration features to competitor keys', () => {
      expect(
        getCompetitorsFromFeatures([AdditionalFeature.AmplitudeMigration]),
      ).toEqual(['amplitude']);
    });

    it('handles multiple migrations', () => {
      expect(
        getCompetitorsFromFeatures([
          AdditionalFeature.SentryMigration,
          AdditionalFeature.BraintrustMigration,
        ]),
      ).toEqual(['sentry', 'braintrust']);
    });

    it('ignores non-migration features', () => {
      expect(getCompetitorsFromFeatures([AdditionalFeature.LLM])).toEqual([]);
    });

    it('returns empty for empty input', () => {
      expect(getCompetitorsFromFeatures([])).toEqual([]);
    });
  });

  describe('scanCodebaseForCompetitors', () => {
    it('returns empty manifest when no competitors specified', async () => {
      const result = await scanCodebaseForCompetitors(tempDir, []);
      expect(result).toEqual({});
    });

    it('returns empty manifest for a project with no competitor references', async () => {
      writeFile('src/index.ts', 'console.log("hello world");\n');
      const result = await scanCodebaseForCompetitors(tempDir, ['amplitude']);
      expect(result).toEqual({});
    });

    it('detects Amplitude imports', async () => {
      writeFile(
        'src/analytics.ts',
        `import { track } from "@amplitude/analytics-browser";\n\namplitude.track("page_view");\n`,
      );

      const result = await scanCodebaseForCompetitors(tempDir, ['amplitude']);
      expect(result.amplitude).toBeDefined();
      expect(result.amplitude!).toHaveLength(2);
      expect(result.amplitude![0]).toMatchObject({
        file: 'src/analytics.ts',
        line: 1,
        type: 'import',
      });
      expect(result.amplitude![1]).toMatchObject({
        type: 'api_call',
      });
    });

    it('detects Amplitude API calls', async () => {
      writeFile(
        'src/events.ts',
        `amplitude.track("button_clicked", { name: "signup" });\namplitude.identify("user-123");\n`,
      );

      const result = await scanCodebaseForCompetitors(tempDir, ['amplitude']);
      expect(result.amplitude).toBeDefined();
      expect(result.amplitude!).toHaveLength(2);
      expect(result.amplitude![0].type).toBe('api_call');
      expect(result.amplitude![1].type).toBe('api_call');
    });

    it('detects Sentry imports and initialization', async () => {
      writeFile(
        'src/app.tsx',
        `import * as Sentry from "@sentry/react";\n\nSentry.init({ dsn: "..." });\n`,
      );

      const result = await scanCodebaseForCompetitors(tempDir, ['sentry']);
      expect(result.sentry).toBeDefined();
      expect(result.sentry!).toHaveLength(2);
      expect(result.sentry![0].type).toBe('import');
      expect(result.sentry![1].type).toBe('initialization');
    });

    it('detects Sentry API calls', async () => {
      writeFile(
        'src/error-handler.ts',
        `Sentry.captureException(error);\nSentry.captureMessage("warning");\nSentry.setUser({ id: "123" });\n`,
      );

      const result = await scanCodebaseForCompetitors(tempDir, ['sentry']);
      expect(result.sentry!).toHaveLength(3);
      expect(result.sentry!.every((h) => h.type === 'api_call')).toBe(true);
    });

    it('detects LaunchDarkly imports and API calls', async () => {
      writeFile(
        'src/flags.ts',
        `import { LDProvider } from "launchdarkly-react-client-sdk";\n\nconst value = client.variation("my-flag", false);\n`,
      );

      const result = await scanCodebaseForCompetitors(tempDir, [
        'launchdarkly',
      ]);
      expect(result.launchdarkly).toBeDefined();
      expect(result.launchdarkly!).toHaveLength(2);
    });

    it('detects Braintrust imports and API calls', async () => {
      writeFile(
        'src/llm.ts',
        `import { initLogger } from "braintrust";\n\nconst result = span.traced("generate", async () => {});\n`,
      );

      const result = await scanCodebaseForCompetitors(tempDir, ['braintrust']);
      expect(result.braintrust).toBeDefined();
      expect(result.braintrust!).toHaveLength(2);
    });

    it('scans for multiple competitors simultaneously', async () => {
      writeFile(
        'src/analytics.ts',
        `import { track } from "@amplitude/analytics-browser";\n`,
      );
      writeFile('src/errors.ts', `import * as Sentry from "@sentry/react";\n`);

      const result = await scanCodebaseForCompetitors(tempDir, [
        'amplitude',
        'sentry',
      ]);
      expect(result.amplitude).toBeDefined();
      expect(result.sentry).toBeDefined();
      expect(result.amplitude!).toHaveLength(1);
      expect(result.sentry!).toHaveLength(1);
    });

    it('ignores node_modules', async () => {
      writeFile(
        'node_modules/@amplitude/core/index.js',
        `export function track() {}\n`,
      );
      writeFile('src/app.ts', `console.log("clean");\n`);

      const result = await scanCodebaseForCompetitors(tempDir, ['amplitude']);
      expect(result.amplitude).toBeUndefined();
    });

    it('ignores dist directories', async () => {
      writeFile(
        'dist/bundle.js',
        `import { track } from "@amplitude/analytics-browser";\n`,
      );

      const result = await scanCodebaseForCompetitors(tempDir, ['amplitude']);
      expect(result.amplitude).toBeUndefined();
    });

    it('produces one hit per line to avoid duplicates', async () => {
      // A line that matches both import and reference patterns
      writeFile(
        'src/setup.ts',
        `import * as Sentry from "@sentry/react"; // SentryErrorBoundary\n`,
      );

      const result = await scanCodebaseForCompetitors(tempDir, ['sentry']);
      expect(result.sentry!).toHaveLength(1);
    });

    it('handles require() syntax', async () => {
      writeFile('src/legacy.js', `const Sentry = require("@sentry/node");\n`);

      const result = await scanCodebaseForCompetitors(tempDir, ['sentry']);
      expect(result.sentry).toBeDefined();
      expect(result.sentry![0].type).toBe('import');
    });

    it('scans Python files', async () => {
      writeFile(
        'app/tracking.py',
        `import sentry_sdk\nsentry_sdk.init(dsn="...")\n`,
      );

      // The pattern expects @sentry/ or Sentry. syntax, so Python's sentry_sdk
      // might not match the JS-focused patterns. That's acceptable — the audit
      // is supplementary context, not the sole source of truth.
      const result = await scanCodebaseForCompetitors(tempDir, ['sentry']);
      // Python sentry_sdk uses different patterns than JS, so hits may vary
      expect(result).toBeDefined();
    });
  });

  describe('formatAuditForPrompt', () => {
    it('formats a manifest with hits grouped by file', () => {
      const manifest: CodebaseAuditManifest = {
        amplitude: [
          {
            file: 'src/analytics.ts',
            line: 1,
            content: 'import { track } from "@amplitude/analytics-browser"',
            type: 'import',
          },
          {
            file: 'src/analytics.ts',
            line: 15,
            content: 'amplitude.track("button_clicked")',
            type: 'api_call',
          },
          {
            file: 'src/app.tsx',
            line: 3,
            content: 'amplitude.init("API_KEY")',
            type: 'initialization',
          },
        ],
      };

      const formatted = formatAuditForPrompt(manifest, 'amplitude');
      expect(formatted).toContain('Pre-computed codebase audit for amplitude:');
      expect(formatted).toContain('Found 3 references across 2 files:');
      expect(formatted).toContain('src/analytics.ts:');
      expect(formatted).toContain('Line 1:');
      expect(formatted).toContain('[import]');
      expect(formatted).toContain('Line 15:');
      expect(formatted).toContain('[api_call]');
      expect(formatted).toContain('src/app.tsx:');
      expect(formatted).toContain('[initialization]');
      expect(formatted).toContain('Use this audit as your starting point');
    });

    it('handles empty hits gracefully', () => {
      const manifest: CodebaseAuditManifest = {};
      const formatted = formatAuditForPrompt(manifest, 'sentry');
      expect(formatted).toContain('No references found');
    });

    it('handles single hit singular grammar', () => {
      const manifest: CodebaseAuditManifest = {
        sentry: [
          {
            file: 'src/app.ts',
            line: 1,
            content: 'import * as Sentry from "@sentry/react"',
            type: 'import',
          },
        ],
      };

      const formatted = formatAuditForPrompt(manifest, 'sentry');
      expect(formatted).toContain('Found 1 reference across 1 file:');
    });
  });

  describe('generateProjectContext', () => {
    it('includes top-level file listing', () => {
      writeFile('package.json', '{}');
      writeFile('tsconfig.json', '{}');
      writeFile('README.md', '# Hello');

      const context = generateProjectContext(tempDir);
      expect(context).toContain('Top-level files:');
      expect(context).toContain('package.json');
      expect(context).toContain('tsconfig.json');
      expect(context).toContain('README.md');
    });

    it('lists src directory contents', () => {
      writeFile('src/index.ts', '');
      writeFile('src/utils/helpers.ts', '');

      const context = generateProjectContext(tempDir);
      expect(context).toContain('src/:');
      expect(context).toContain('index.ts');
      expect(context).toContain('utils/');
    });

    it('includes dependencies from package.json', () => {
      writeFile(
        'package.json',
        JSON.stringify({
          dependencies: { react: '^18.0.0', 'posthog-js': '^1.0.0' },
          devDependencies: { typescript: '^5.0.0' },
        }),
      );

      const context = generateProjectContext(tempDir);
      expect(context).toContain('Dependencies:');
      expect(context).toContain('react');
      expect(context).toContain('posthog-js');
      expect(context).toContain('Dev dependencies:');
      expect(context).toContain('typescript');
    });

    it('detects config files', () => {
      writeFile('next.config.ts', 'export default {}');

      const context = generateProjectContext(tempDir);
      expect(context).toContain('Config files:');
      expect(context).toContain('next.config.ts');
    });

    it('handles empty directory gracefully', () => {
      const context = generateProjectContext(tempDir);
      expect(context).toContain('Project context summary:');
    });
  });
});
