/**
 * The web analytics step: which conversions the scan proposes from a project's
 * code, and which runs carry the step that turns one into a goal.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WizardSession } from '@services/session';
import { Integration } from '@shared/constants';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));

import {
  config as posthogIntegration,
  WIZARD_WEB_ANALYTICS_SETUP_FLAG_KEY,
} from '@programs/posthog-integration';
import { buildSession } from '@services/session';
import {
  routeForFile,
  scanConversionCandidates,
} from '../web-analytics/conversion-candidates';

type Tree = Record<string, string>;

/** A Next.js SaaS: an email sign-up form, Stripe checkout from pricing, a thank-you page. */
const NEXT_SAAS: Tree = {
  'app/(auth)/signup/page.tsx': `
    export default function SignUp() {
      return <form onSubmit={handleSubmit}><input name="email" /></form>;
    }`,
  'app/pricing/page.tsx': `
    const go = () => stripe.redirectToCheckout({ sessionId });
    export default function Pricing() { return <button onClick={go}>Buy</button>; }`,
  'app/thank-you/page.tsx': `export default function Thanks() { return <p>Thanks</p>; }`,
  'app/about/page.tsx': `export default function About() { return <p>About</p>; }`,
};

/** A marketing site: a contact form and a Calendly embed to book a demo. */
const MARKETING: Tree = {
  'src/pages/contact.astro': `<form method="post" action="/api/contact"></form>`,
  'src/components/BookDemo.tsx': `
    export const BookDemo = () => <iframe src="https://calendly.com/acme/demo" />;`,
  'src/pages/index.astro': `<h1>Acme</h1>`,
};

/** A React SPA whose routes are declared in code, already capturing its sign-up with PostHog. */
const SPA: Tree = {
  'src/App.tsx': `
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/register" element={<Register />} />
    </Routes>`,
  'src/Register.tsx': `
    function onDone() { posthog.capture('user_signed_up', { plan }); }
    export const Register = () => <form onSubmit={onDone} />;`,
  'src/__tests__/Register.test.tsx': `
    posthog.capture('checkout_completed'); render(<form />);`,
};

let dirs: string[] = [];

function project(tree: Tree): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-conversions-'));
  dirs.push(dir);
  for (const [file, content] of Object.entries(tree)) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('routeForFile', () => {
  it.each([
    ['app/(auth)/signup/page.tsx', '/signup'],
    ['app/page.tsx', '/'],
    ['pages/checkout.tsx', '/checkout'],
    ['pages/contact/index.jsx', '/contact'],
    ['src/routes/book-a-demo/+page.svelte', '/book-a-demo'],
    ['src/pages/contact.astro', '/contact'],
    ['src/components/Signup.tsx', undefined],
  ])('maps %s to %s', (file, route) => {
    expect(routeForFile(file)).toBe(route);
  });
});

describe('scanConversionCandidates', () => {
  it('ranks a SaaS sign-up form above its checkout and finds the thank-you page', () => {
    const scan = scanConversionCandidates(project(NEXT_SAAS));

    expect(scan.candidates.map((c) => c.kind)).toEqual(['signup', 'checkout']);
    expect(scan.candidates[0]).toMatchObject({
      label: 'Sign up',
      route: '/signup',
      files: [path.join('app', '(auth)', 'signup', 'page.tsx')],
      signals: ['route /signup', 'form'],
    });
    expect(scan.candidates[1].signals).toEqual([
      'existing conversion tracking',
    ]);
    expect(scan.successRoutes).toEqual(['/thank-you']);
  });

  it('finds a contact form and a demo booking on a marketing site', () => {
    const scan = scanConversionCandidates(project(MARKETING));

    expect(scan.candidates.map((c) => c.kind).sort()).toEqual([
      'contact',
      'demo',
    ]);
    expect(scan.candidates.find((c) => c.kind === 'contact')?.route).toBe(
      '/contact',
    );
  });

  it('prefers an event the project already captures, and ignores tests', () => {
    const scan = scanConversionCandidates(project(SPA));

    expect(scan.candidates.map((c) => c.kind)).toEqual(['signup']);
    expect(scan.candidates[0]).toMatchObject({
      posthogEvent: 'user_signed_up',
      route: '/register',
    });
  });

  it('proposes nothing where the code has no conversion flow', () => {
    const scan = scanConversionCandidates(
      project({ 'app/about/page.tsx': '<form onSubmit={search} />' }),
    );
    expect(scan).toEqual({ candidates: [], successRoutes: [] });
  });
});

describe('web analytics seed task', () => {
  function session(over: Partial<WizardSession> = {}): WizardSession {
    return {
      ...buildSession({ installDir: project(NEXT_SAAS) }),
      integration: Integration.nextjs,
      ...over,
    } as WizardSession;
  }
  const seed = (sess: WizardSession) =>
    (posthogIntegration.seedTasks?.(sess) ?? []).filter(
      (t) => t.type === 'web-analytics',
    );
  const flagOn = { [WIZARD_WEB_ANALYTICS_SETUP_FLAG_KEY]: 'true' };

  it('queues the step with the scan as its input for a web app', () => {
    const [task] = seed(session());

    expect(task.inputs).toMatchObject({
      conversionCandidates: [
        expect.objectContaining({ kind: 'signup', route: '/signup' }),
        expect.objectContaining({ kind: 'checkout' }),
      ],
      successRoutes: ['/thank-you'],
    });
    expect(task.notice?.items).toEqual(['Sign up', 'Checkout or purchase']);
  });

  it('says so in the notice when the scan found no conversion', () => {
    const [task] = seed(
      session({ installDir: project({ 'app/page.tsx': '' }) }),
    );
    expect(task.notice?.items).toEqual([]);
    expect(task.notice?.body[1]).toMatch(/didn't find/);
  });

  it('queues nothing for a project without a web UI', () => {
    expect(seed(session({ integration: Integration.django }))).toEqual([]);
  });

  it('queues nothing in CI, where nobody can confirm the goal', () => {
    expect(seed(session({ ci: true }))).toEqual([]);
  });

  it("runs only where its launch flag reads 'true'", () => {
    const sess = session();
    const excluded = (flags: Record<string, string>) =>
      posthogIntegration.excludedTaskTypes!(flags, sess).includes(
        'web-analytics',
      );

    expect(excluded(flagOn)).toBe(false);
    expect(excluded({})).toBe(true);
    expect(excluded({ [WIZARD_WEB_ANALYTICS_SETUP_FLAG_KEY]: 'false' })).toBe(
      true,
    );
  });

  it('tells the capture task about the top conversion only while the step runs', () => {
    const sess = session();
    const facts = (flags: Record<string, string>) =>
      posthogIntegration.detectedFacts!(flags, sess);

    expect(facts(flagOn)).toEqual([
      expect.stringContaining(
        "Most likely conversion from the wizard's scan: Sign up (route /signup, form;",
      ),
    ]);
    expect(facts({})).toEqual([]);
  });
});
