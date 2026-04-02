import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { detectStripe } from '../stripe-detection';

function createFixture(files: Record<string, string>): {
  dir: string;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-stripe-'));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe('detectStripe', () => {
  describe('Node.js', () => {
    test('detects Stripe from package.json', () => {
      const { dir, cleanup } = createFixture({
        'package.json': JSON.stringify({
          dependencies: { stripe: '^14.0.0' },
        }),
      });
      try {
        const result = detectStripe(dir, 'node');
        expect(result).not.toBeNull();
        expect(result!.sdkPackage).toBe('package.json');
        expect(result!.language).toBe('node');
      } finally {
        cleanup();
      }
    });

    test('extracts version from package-lock.json', () => {
      const { dir, cleanup } = createFixture({
        'package.json': JSON.stringify({
          dependencies: { stripe: '^14.0.0' },
        }),
        'package-lock.json': JSON.stringify({
          packages: { 'node_modules/stripe': { version: '14.21.0' } },
        }),
      });
      try {
        const result = detectStripe(dir, 'node');
        expect(result).not.toBeNull();
        expect(result!.sdkVersion).toBe('14.21.0');
      } finally {
        cleanup();
      }
    });

    test('finds customer creation calls', () => {
      const { dir, cleanup } = createFixture({
        'package.json': JSON.stringify({
          dependencies: { stripe: '^14.0.0' },
        }),
        'src/billing.ts': `import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const customer = await stripe.customers.create({
  email: user.email,
});`,
      });
      try {
        const result = detectStripe(dir, 'node');
        expect(result).not.toBeNull();
        expect(result!.customerCreationCalls).toHaveLength(1);
        expect(result!.customerCreationCalls[0].file).toBe('src/billing.ts');
        expect(result!.customerCreationCalls[0].line).toBe(4);
      } finally {
        cleanup();
      }
    });

    test('finds charge patterns', () => {
      const { dir, cleanup } = createFixture({
        'package.json': JSON.stringify({
          dependencies: { stripe: '^14.0.0' },
        }),
        'src/payments.ts': `const intent = await stripe.paymentIntents.create({
  amount: 1000,
  currency: 'usd',
});

const sub = await stripe.subscriptions.create({
  customer: customerId,
});

const session = await stripe.checkout.sessions.create({
  mode: 'payment',
});`,
      });
      try {
        const result = detectStripe(dir, 'node');
        expect(result).not.toBeNull();
        expect(result!.chargeCalls).toHaveLength(3);
        expect(result!.chargeCalls.map((c) => c.type)).toEqual([
          'payment_intent',
          'subscription',
          'checkout_session',
        ]);
        expect(result!.usesCheckoutSessions).toBe(true);
      } finally {
        cleanup();
      }
    });

    test('returns null when Stripe is not installed', () => {
      const { dir, cleanup } = createFixture({
        'package.json': JSON.stringify({
          dependencies: { express: '^4.0.0' },
        }),
      });
      try {
        expect(detectStripe(dir, 'node')).toBeNull();
      } finally {
        cleanup();
      }
    });
  });

  describe('Python', () => {
    test('detects Stripe from requirements.txt', () => {
      const { dir, cleanup } = createFixture({
        'requirements.txt': 'stripe>=5.0.0\nflask',
      });
      try {
        const result = detectStripe(dir, 'python');
        expect(result).not.toBeNull();
        expect(result!.sdkPackage).toBe('requirements.txt');
      } finally {
        cleanup();
      }
    });

    test('detects Stripe from uv.lock', () => {
      const { dir, cleanup } = createFixture({
        'uv.lock': `[[package]]
name = "stripe"
version = "11.4.1"
source = { registry = "https://pypi.org/simple" }`,
      });
      try {
        const result = detectStripe(dir, 'python');
        expect(result).not.toBeNull();
        expect(result!.sdkPackage).toBe('uv.lock');
      } finally {
        cleanup();
      }
    });

    test('detects Stripe from poetry.lock', () => {
      const { dir, cleanup } = createFixture({
        'poetry.lock': `[[package]]
name = "stripe"
version = "11.4.1"`,
      });
      try {
        const result = detectStripe(dir, 'python');
        expect(result).not.toBeNull();
        expect(result!.sdkPackage).toBe('poetry.lock');
      } finally {
        cleanup();
      }
    });

    test('finds Python customer creation', () => {
      const { dir, cleanup } = createFixture({
        'requirements.txt': 'stripe>=5.0.0',
        'billing.py': `import stripe

customer = stripe.Customer.create(
    email=user.email,
)`,
      });
      try {
        const result = detectStripe(dir, 'python');
        expect(result).not.toBeNull();
        expect(result!.customerCreationCalls).toHaveLength(1);
      } finally {
        cleanup();
      }
    });

    test('finds Python charge patterns', () => {
      const { dir, cleanup } = createFixture({
        'requirements.txt': 'stripe>=5.0.0',
        'payments.py': `import stripe

intent = stripe.PaymentIntent.create(
    amount=1000,
    currency="usd",
)

sub = stripe.Subscription.create(
    customer=customer_id,
)`,
      });
      try {
        const result = detectStripe(dir, 'python');
        expect(result).not.toBeNull();
        expect(result!.chargeCalls).toHaveLength(2);
      } finally {
        cleanup();
      }
    });
  });

  describe('Ruby', () => {
    test('detects Stripe from Gemfile', () => {
      const { dir, cleanup } = createFixture({
        Gemfile: "gem 'stripe'",
      });
      try {
        const result = detectStripe(dir, 'ruby');
        expect(result).not.toBeNull();
        expect(result!.sdkPackage).toBe('Gemfile');
      } finally {
        cleanup();
      }
    });

    test('finds Ruby customer creation', () => {
      const { dir, cleanup } = createFixture({
        Gemfile: "gem 'stripe'",
        'app/services/billing.rb': `Stripe::Customer.create({
  email: user.email,
})`,
      });
      try {
        const result = detectStripe(dir, 'ruby');
        expect(result!.customerCreationCalls).toHaveLength(1);
      } finally {
        cleanup();
      }
    });
  });

  describe('PHP', () => {
    test('detects Stripe from composer.json', () => {
      const { dir, cleanup } = createFixture({
        'composer.json': JSON.stringify({
          require: { 'stripe/stripe-php': '^12.0' },
        }),
      });
      try {
        const result = detectStripe(dir, 'php');
        expect(result).not.toBeNull();
        expect(result!.sdkPackage).toBe('composer.json');
      } finally {
        cleanup();
      }
    });
  });

  describe('Go', () => {
    test('detects Stripe from go.mod', () => {
      const { dir, cleanup } = createFixture({
        'go.mod': `module myapp

require github.com/stripe/stripe-go/v76 v76.0.0`,
      });
      try {
        const result = detectStripe(dir, 'go');
        expect(result).not.toBeNull();
        expect(result!.sdkPackage).toBe('go.mod');
      } finally {
        cleanup();
      }
    });
  });

  describe('Java', () => {
    test('detects Stripe from build.gradle', () => {
      const { dir, cleanup } = createFixture({
        'build.gradle': `dependencies {
    implementation 'com.stripe:stripe-java:24.0.0'
}`,
      });
      try {
        const result = detectStripe(dir, 'java');
        expect(result).not.toBeNull();
        expect(result!.sdkPackage).toBe('build.gradle');
      } finally {
        cleanup();
      }
    });
  });

  describe('.NET', () => {
    test('detects Stripe from .csproj', () => {
      const { dir, cleanup } = createFixture({
        'MyApp.csproj': `<Project>
  <ItemGroup>
    <PackageReference Include="Stripe.net" Version="43.0.0" />
  </ItemGroup>
</Project>`,
      });
      try {
        const result = detectStripe(dir, 'dotnet');
        expect(result).not.toBeNull();
        expect(result!.sdkVersion).toBe('43.0.0');
      } finally {
        cleanup();
      }
    });
  });

  describe('monorepo support', () => {
    test('detects Stripe from subdirectory package.json', () => {
      const { dir, cleanup } = createFixture({
        'backend/package.json': JSON.stringify({
          dependencies: { stripe: '^14.0.0' },
        }),
      });
      try {
        const result = detectStripe(dir, 'node');
        expect(result).not.toBeNull();
        expect(result!.sdkPackage).toBe('backend/package.json');
      } finally {
        cleanup();
      }
    });

    test('extracts version from subdirectory lockfile', () => {
      const { dir, cleanup } = createFixture({
        'backend/package.json': JSON.stringify({
          dependencies: { stripe: '^14.0.0' },
        }),
        'backend/package-lock.json': JSON.stringify({
          packages: { 'node_modules/stripe': { version: '14.21.0' } },
        }),
      });
      try {
        const result = detectStripe(dir, 'node');
        expect(result).not.toBeNull();
        expect(result!.sdkVersion).toBe('14.21.0');
      } finally {
        cleanup();
      }
    });

    test('finds customer creation calls in subdirectory', () => {
      const { dir, cleanup } = createFixture({
        'backend/package.json': JSON.stringify({
          dependencies: { stripe: '^14.0.0' },
        }),
        'backend/src/billing.ts': `const customer = await stripe.customers.create({
  email: user.email,
});`,
      });
      try {
        const result = detectStripe(dir, 'node');
        expect(result).not.toBeNull();
        expect(result!.customerCreationCalls).toHaveLength(1);
        expect(result!.customerCreationCalls[0].file).toBe(
          'backend/src/billing.ts',
        );
      } finally {
        cleanup();
      }
    });

    test('detects Python Stripe in subdirectory', () => {
      const { dir, cleanup } = createFixture({
        'server/requirements.txt': 'stripe>=5.0.0\nflask',
      });
      try {
        const result = detectStripe(dir, 'python');
        expect(result).not.toBeNull();
        expect(result!.sdkPackage).toBe('server/requirements.txt');
      } finally {
        cleanup();
      }
    });
  });
});
