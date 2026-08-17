import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectWarehouseSources,
  parseGemfile,
  parseEnvKeys,
} from '@lib/warehouse-sources/detect';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-detect-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writePackageJson(
  dir: string,
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {},
): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps }),
  );
}

function kinds(dir: string): string[] {
  return detectWarehouseSources(dir)
    .map((s) => s.kind)
    .sort();
}

describe('detectWarehouseSources', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('returns empty for a non-existent directory', () => {
    expect(detectWarehouseSources(path.join(tmpDir, 'nope'))).toEqual([]);
  });

  it('returns empty when no source signal is present', () => {
    writePackageJson(tmpDir, { react: '^18.0.0' });
    expect(detectWarehouseSources(tmpDir)).toEqual([]);
  });

  it('detects Postgres from an npm driver dependency', () => {
    writePackageJson(tmpDir, { pg: '^8.0.0' });
    expect(kinds(tmpDir)).toEqual(['Postgres']);
  });

  it('detects Stripe from a dependency', () => {
    writePackageJson(tmpDir, { stripe: '^14.0.0' });
    const [stripe] = detectWarehouseSources(tmpDir);
    expect(stripe.kind).toBe('Stripe');
    expect(stripe.mode).toBe('in-cli');
    expect(stripe.matchedSignal).toContain('stripe');
  });

  it('detects a deep-link source (Salesforce) and tags its mode', () => {
    writePackageJson(tmpDir, { jsforce: '^3.0.0' });
    const [salesforce] = detectWarehouseSources(tmpDir);
    expect(salesforce.kind).toBe('Salesforce');
    expect(salesforce.mode).toBe('deep-link');
  });

  it('detects newly added SaaS sources by their SDK package', () => {
    writePackageJson(tmpDir, {
      convex: '^1.0.0',
      '@clerk/nextjs': '^5.0.0',
      resend: '^4.0.0',
    });
    const detected = detectWarehouseSources(tmpDir);
    const byKind = Object.fromEntries(detected.map((s) => [s.kind, s.mode]));
    expect(byKind.Convex).toBe('in-cli');
    expect(byKind.Clerk).toBe('in-cli');
    expect(byKind.Resend).toBe('in-cli');
  });

  it('detects newly added in-cli SaaS sources by their SDK package', () => {
    writePackageJson(tmpDir, {
      twilio: '^5.0.0',
      '@sendgrid/mail': '^8.0.0',
      plaid: '^25.0.0',
      braintree: '^3.0.0',
      square: '^38.0.0',
      'launchdarkly-node-server-sdk': '^7.0.0',
      '@notionhq/client': '^2.0.0',
      '@mollie/api-client': '^4.0.0',
    });
    const detected = detectWarehouseSources(tmpDir);
    const byKind = Object.fromEntries(detected.map((s) => [s.kind, s.mode]));
    expect(byKind.Twilio).toBe('in-cli');
    expect(byKind.SendGrid).toBe('in-cli');
    expect(byKind.Plaid).toBe('in-cli');
    expect(byKind.Braintree).toBe('in-cli');
    expect(byKind.Square).toBe('in-cli');
    expect(byKind.LaunchDarkly).toBe('in-cli');
    expect(byKind.Notion).toBe('in-cli');
    expect(byKind.Mollie).toBe('in-cli');
  });

  it('detects Slack and GitHub as deep-link OAuth sources', () => {
    writePackageJson(tmpDir, {
      '@slack/web-api': '^7.0.0',
      '@octokit/rest': '^21.0.0',
    });
    const detected = detectWarehouseSources(tmpDir);
    const byKind = Object.fromEntries(detected.map((s) => [s.kind, s.mode]));
    expect(byKind.Slack).toBe('deep-link');
    // ExternalDataSourceType value is 'Github', not 'GitHub'.
    expect(byKind.Github).toBe('deep-link');
  });

  it('detects LLM/AI SaaS sources by their SDK package as in-cli', () => {
    writePackageJson(tmpDir, {
      openai: '^4.0.0',
      '@anthropic-ai/sdk': '^0.30.0',
      'groq-sdk': '^0.9.0',
    });
    const byKind = Object.fromEntries(
      detectWarehouseSources(tmpDir).map((s) => [s.kind, s.mode]),
    );
    expect(byKind.OpenAI).toBe('in-cli');
    expect(byKind.Anthropic).toBe('in-cli');
    expect(byKind.Groq).toBe('in-cli');
  });

  it('detects ad-platform sources as deep-link OAuth sources', () => {
    writePackageJson(tmpDir, {
      'google-ads-api': '^17.0.0',
      'facebook-nodejs-business-sdk': '^20.0.0',
    });
    const byKind = Object.fromEntries(
      detectWarehouseSources(tmpDir).map((s) => [s.kind, s.mode]),
    );
    expect(byKind.GoogleAds).toBe('deep-link');
    expect(byKind.MetaAds).toBe('deep-link');
  });

  it('detects newly added sources from Python, Ruby, and env signals', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'python-gitlab==4.0.0\n',
    );
    fs.writeFileSync(path.join(tmpDir, 'Gemfile'), "gem 'newrelic_rpm'\n");
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'DATADOG_API_KEY=x\nSTYTCH_SECRET=y\n',
    );
    expect(kinds(tmpDir)).toEqual(
      ['Datadog', 'GitLab', 'NewRelic', 'Stytch'].sort(),
    );
  });

  it('detects sources from Python and Ruby deps and env keys', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'launchdarkly-server-sdk==9.0.0\nrollbar==1.0.0\n',
    );
    fs.writeFileSync(path.join(tmpDir, 'Gemfile'), "gem 'recurly'\n");
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'TWILIO_AUTH_TOKEN=x\nMJ_APIKEY_PUBLIC=y\nCKO_SECRET_KEY=z\n',
    );
    expect(kinds(tmpDir)).toEqual(
      [
        'CheckoutCom',
        'LaunchDarkly',
        'Mailjet',
        'Recurly',
        'Rollbar',
        'Twilio',
      ].sort(),
    );
  });

  it('detects Postgres from a Python requirement', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'psycopg2-binary==2.9.9\nflask>=3.0\n',
    );
    expect(kinds(tmpDir)).toEqual(['Postgres']);
  });

  it('detects from .env key names without reading values', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'DATABASE_URL=postgres://secret@host/db\nSTRIPE_SECRET_KEY=sk_live_x\n',
    );
    expect(kinds(tmpDir)).toEqual(['Postgres', 'Stripe']);
  });

  it('dedupes a source matched by multiple signals', () => {
    writePackageJson(tmpDir, { pg: '^8.0.0' });
    fs.writeFileSync(path.join(tmpDir, '.env'), 'DATABASE_URL=x\nPGHOST=y\n');
    expect(kinds(tmpDir)).toEqual(['Postgres']);
  });

  it('finds sources in nested packages (monorepo)', () => {
    const sub = path.join(tmpDir, 'apps', 'api');
    fs.mkdirSync(sub, { recursive: true });
    writePackageJson(sub, { mysql2: '^3.0.0' });
    expect(kinds(tmpDir)).toEqual(['MySQL']);
  });

  it('follows a symlinked directory to find sources', () => {
    // Manifest lives in an external dir reachable only via a symlink inside
    // the project — exercises symlink resolution in the walker.
    const external = makeTmpDir();
    try {
      writePackageJson(external, { mysql2: '^3.0.0' });
      fs.symlinkSync(external, path.join(tmpDir, 'linked-pkg'), 'dir');
      expect(kinds(tmpDir)).toEqual(['MySQL']);
    } finally {
      cleanup(external);
    }
  });

  it('ignores node_modules', () => {
    const nm = path.join(tmpDir, 'node_modules', 'pg');
    fs.mkdirSync(nm, { recursive: true });
    writePackageJson(nm, { pg: '^8.0.0' });
    expect(detectWarehouseSources(tmpDir)).toEqual([]);
  });
});

describe('parseGemfile', () => {
  it('extracts gem names', () => {
    const content = `source 'https://rubygems.org'\ngem 'pg', '~> 1.5'\ngem "stripe"\n# gem 'commented'`;
    expect(parseGemfile(content)).toEqual(['pg', 'stripe']);
  });
});

describe('parseEnvKeys', () => {
  it('extracts key names and discards values', () => {
    const content =
      'export FOO=bar\nBAZ = qux\n# COMMENT=1\nDATABASE_URL=postgres://x';
    expect(parseEnvKeys(content)).toEqual(['FOO', 'BAZ', 'DATABASE_URL']);
  });
});
