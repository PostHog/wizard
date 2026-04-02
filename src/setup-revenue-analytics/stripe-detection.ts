/**
 * Stripe SDK detection — finds Stripe packages, versions, and API call patterns.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import type {
  Language,
  StripeDetectionResult,
  StripeCallLocation,
  StripeChargeCall,
} from './types';

const STRIPE_PACKAGES: Record<Language, { file: string; pattern: RegExp }[]> = {
  node: [{ file: 'package.json', pattern: /"stripe"/ }],
  python: [
    { file: 'requirements.txt', pattern: /^stripe([>=~!<\s]|$)/m },
    { file: 'pyproject.toml', pattern: /["']stripe["']/ },
    { file: 'Pipfile', pattern: /stripe/ },
  ],
  ruby: [{ file: 'Gemfile', pattern: /['"]stripe['"]/ }],
  php: [{ file: 'composer.json', pattern: /"stripe\/stripe-php"/ }],
  go: [{ file: 'go.mod', pattern: /github\.com\/stripe\/stripe-go/ }],
  java: [
    { file: 'build.gradle', pattern: /com\.stripe:stripe-java/ },
    { file: 'build.gradle.kts', pattern: /com\.stripe:stripe-java/ },
    { file: 'pom.xml', pattern: /stripe-java/ },
  ],
  dotnet: [{ file: '*.csproj', pattern: /Stripe\.net/i }],
};

const CUSTOMER_CREATE_PATTERNS: Record<Language, RegExp> = {
  node: /stripe\.customers\.create\s*\(/,
  python: /stripe\.Customer\.create\s*\(/,
  ruby: /Stripe::Customer\.create\s*\(/,
  php: /(?:\$stripe->customers->create|\\\s*Stripe\\\s*Customer::create)\s*\(/,
  go: /customer\.New\s*\(/,
  java: /Customer\.create\s*\(/,
  dotnet: /(?:CustomerService|customerService).*\.Create/,
};

type ChargeType = StripeChargeCall['type'];

const CHARGE_PATTERNS: Record<
  Language,
  { pattern: RegExp; type: ChargeType }[]
> = {
  node: [
    { pattern: /stripe\.paymentIntents\.create\s*\(/, type: 'payment_intent' },
    { pattern: /stripe\.subscriptions\.create\s*\(/, type: 'subscription' },
    {
      pattern: /stripe\.checkout\.sessions\.create\s*\(/,
      type: 'checkout_session',
    },
    { pattern: /stripe\.invoices\.create\s*\(/, type: 'invoice' },
  ],
  python: [
    { pattern: /stripe\.PaymentIntent\.create\s*\(/, type: 'payment_intent' },
    { pattern: /stripe\.Subscription\.create\s*\(/, type: 'subscription' },
    {
      pattern: /stripe\.checkout\.Session\.create\s*\(/,
      type: 'checkout_session',
    },
    { pattern: /stripe\.Invoice\.create\s*\(/, type: 'invoice' },
  ],
  ruby: [
    { pattern: /Stripe::PaymentIntent\.create\s*\(/, type: 'payment_intent' },
    { pattern: /Stripe::Subscription\.create\s*\(/, type: 'subscription' },
    {
      pattern: /Stripe::Checkout::Session\.create\s*\(/,
      type: 'checkout_session',
    },
    { pattern: /Stripe::Invoice\.create\s*\(/, type: 'invoice' },
  ],
  php: [
    {
      pattern: /(?:paymentIntents->create|PaymentIntent::create)\s*\(/,
      type: 'payment_intent',
    },
    {
      pattern: /(?:subscriptions->create|Subscription::create)\s*\(/,
      type: 'subscription',
    },
    {
      pattern: /(?:checkout->sessions->create|Session::create)\s*\(/,
      type: 'checkout_session',
    },
    { pattern: /(?:invoices->create|Invoice::create)\s*\(/, type: 'invoice' },
  ],
  go: [
    { pattern: /paymentintent\.New\s*\(/, type: 'payment_intent' },
    { pattern: /sub\.New\s*\(/, type: 'subscription' },
    { pattern: /session\.New\s*\(/, type: 'checkout_session' },
    { pattern: /invoice\.New\s*\(/, type: 'invoice' },
  ],
  java: [
    { pattern: /PaymentIntent\.create\s*\(/, type: 'payment_intent' },
    { pattern: /Subscription\.create\s*\(/, type: 'subscription' },
    { pattern: /Session\.create\s*\(/, type: 'checkout_session' },
    { pattern: /Invoice\.create\s*\(/, type: 'invoice' },
  ],
  dotnet: [
    { pattern: /PaymentIntentService.*\.Create/, type: 'payment_intent' },
    { pattern: /SubscriptionService.*\.Create/, type: 'subscription' },
    { pattern: /SessionService.*\.Create/, type: 'checkout_session' },
    { pattern: /InvoiceService.*\.Create/, type: 'invoice' },
  ],
};

const FILE_EXTENSIONS: Record<Language, string> = {
  node: '**/*.{ts,js,tsx,jsx,mjs,cjs}',
  python: '**/*.py',
  ruby: '**/*.rb',
  php: '**/*.php',
  go: '**/*.go',
  java: '**/*.{java,kt,kts}',
  dotnet: '**/*.{cs,fs}',
};

const IGNORE_DIRS = [
  '**/node_modules/**',
  '**/venv/**',
  '**/.venv/**',
  '**/env/**',
  '**/.env/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/bin/**',
  '**/obj/**',
];

function detectStripePackage(
  installDir: string,
  language: Language,
): string | null {
  const checks = STRIPE_PACKAGES[language];
  for (const { file, pattern } of checks) {
    try {
      if (file.includes('*')) {
        const matches = fg.sync(file, { cwd: installDir, deep: 2 });
        for (const match of matches) {
          const content = fs.readFileSync(
            path.join(installDir, match),
            'utf-8',
          );
          if (pattern.test(content)) return match;
        }
      } else {
        const filePath = path.join(installDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        if (pattern.test(content)) return file;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function extractStripeVersion(
  installDir: string,
  language: Language,
): string | null {
  try {
    switch (language) {
      case 'node': {
        // Try package-lock.json first
        for (const lockfile of [
          'package-lock.json',
          'yarn.lock',
          'pnpm-lock.yaml',
        ]) {
          const lockPath = path.join(installDir, lockfile);
          if (!fs.existsSync(lockPath)) continue;
          const content = fs.readFileSync(lockPath, 'utf-8');

          if (lockfile === 'package-lock.json') {
            const parsed = JSON.parse(content);
            const stripePkg =
              parsed.packages?.['node_modules/stripe'] ??
              parsed.dependencies?.stripe;
            if (stripePkg?.version) return stripePkg.version;
          } else if (lockfile === 'yarn.lock') {
            const match = content.match(/stripe@[^:]+:\s+version\s+"([^"]+)"/);
            if (match) return match[1];
          } else if (lockfile === 'pnpm-lock.yaml') {
            const match = content.match(/stripe@([^\s:]+)/);
            if (match) return match[1];
          }
        }
        // Fallback to package.json version range
        const pkgJson = JSON.parse(
          fs.readFileSync(path.join(installDir, 'package.json'), 'utf-8'),
        );
        const ver =
          pkgJson.dependencies?.stripe ?? pkgJson.devDependencies?.stripe;
        return ver ?? null;
      }
      case 'python': {
        for (const lockfile of ['requirements.txt', 'poetry.lock', 'uv.lock']) {
          const lockPath = path.join(installDir, lockfile);
          if (!fs.existsSync(lockPath)) continue;
          const content = fs.readFileSync(lockPath, 'utf-8');
          const match = content.match(/stripe[=~>=<]+([0-9][0-9.]*)/i);
          if (match) return match[1];
        }
        return null;
      }
      case 'ruby': {
        const lockPath = path.join(installDir, 'Gemfile.lock');
        if (fs.existsSync(lockPath)) {
          const content = fs.readFileSync(lockPath, 'utf-8');
          const match = content.match(/stripe\s+\(([^)]+)\)/);
          if (match) return match[1];
        }
        return null;
      }
      case 'php': {
        const lockPath = path.join(installDir, 'composer.lock');
        if (fs.existsSync(lockPath)) {
          const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
          const pkg = parsed.packages?.find(
            (p: { name: string }) => p.name === 'stripe/stripe-php',
          );
          if (pkg?.version) return pkg.version.replace(/^v/, '');
        }
        return null;
      }
      case 'go': {
        const sumPath = path.join(installDir, 'go.sum');
        if (fs.existsSync(sumPath)) {
          const content = fs.readFileSync(sumPath, 'utf-8');
          const match = content.match(
            /github\.com\/stripe\/stripe-go\/v\d+\s+v([^\s]+)/,
          );
          if (match) return match[1];
        }
        return null;
      }
      case 'java': {
        for (const buildFile of [
          'build.gradle',
          'build.gradle.kts',
          'pom.xml',
        ]) {
          const filePath = path.join(installDir, buildFile);
          if (!fs.existsSync(filePath)) continue;
          const content = fs.readFileSync(filePath, 'utf-8');
          const match = content.match(/stripe-java[:'"\s]+([0-9][0-9.]*)/);
          if (match) return match[1];
        }
        return null;
      }
      case 'dotnet': {
        const csprojFiles = fg.sync('**/*.csproj', {
          cwd: installDir,
          deep: 3,
        });
        for (const file of csprojFiles) {
          const content = fs.readFileSync(path.join(installDir, file), 'utf-8');
          const match = content.match(
            /Stripe\.net['"]\s+Version=['"]([^'"]+)/i,
          );
          if (match) return match[1];
        }
        return null;
      }
    }
  } catch {
    return null;
  }
}

function scanForPatterns(
  installDir: string,
  language: Language,
  pattern: RegExp,
): StripeCallLocation[] {
  const results: StripeCallLocation[] = [];
  const files = fg.sync(FILE_EXTENSIONS[language], {
    cwd: installDir,
    ignore: IGNORE_DIRS,
  });

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(installDir, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          results.push({
            file,
            line: i + 1,
            snippet: lines[i].trim(),
          });
        }
      }
    } catch {
      continue;
    }
  }
  return results;
}

export function detectStripe(
  installDir: string,
  language: Language,
): StripeDetectionResult | null {
  const packageFile = detectStripePackage(installDir, language);
  if (!packageFile) return null;

  const sdkVersion = extractStripeVersion(installDir, language);

  const customerCreationCalls = scanForPatterns(
    installDir,
    language,
    CUSTOMER_CREATE_PATTERNS[language],
  );

  const chargeCalls: StripeChargeCall[] = [];
  for (const { pattern, type } of CHARGE_PATTERNS[language]) {
    const locations = scanForPatterns(installDir, language, pattern);
    chargeCalls.push(...locations.map((loc) => ({ ...loc, type })));
  }

  const usesCheckoutSessions = chargeCalls.some(
    (c) => c.type === 'checkout_session',
  );

  return {
    sdkPackage: packageFile,
    sdkVersion,
    language,
    customerCreationCalls,
    chargeCalls,
    usesCheckoutSessions,
  };
}
