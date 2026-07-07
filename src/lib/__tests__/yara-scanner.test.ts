import { scan } from '@lib/yara-scanner';

/** Rule names matched when `content` is scanned as written (Write/Edit) output. */
function writeMatches(content: string): string[] {
  const result = scan(content, 'PostToolUse', 'Write');
  return result.matched ? result.matches.map((m) => m.rule.name) : [];
}

describe('pii_in_capture_call', () => {
  test('matches PII keys at the top level of capture() properties', () => {
    const cases = [
      `posthog.capture('signup', { email: user.email })`,
      `posthog.capture('signup', { 'email': value })`,
      `client.capture('purchase', { credit_card: cc })`,
      `posthog.capture('profile_saved', { firstName: name })`,
      `posthog.capture('kyc', { ssn: input.ssn })`,
    ];
    for (const code of cases) {
      expect(writeMatches(code)).toContain('pii_in_capture_call');
    }
  });

  test('matches sensitive PII in identify() but allows standard identifying fields', () => {
    expect(writeMatches(`posthog.identify(id, { ssn: user.ssn })`)).toContain(
      'pii_in_capture_call',
    );
    expect(
      writeMatches(`posthog.identify(id, { email: user.email, name })`),
    ).toEqual([]);
  });

  // Field false positives from the 2026-07-07 triage — each remark quote is a
  // fixture. These blocked real integrations ~4× per affected run on pi.

  test('FP: event names containing a PII word do not match', () => {
    const cases = [
      `posthog.capture('email_verified', { method: 'oauth' })`,
      `posthog.capture('email_sent')`,
      `posthog.capture('phone_call_started', { durationBucket })`,
    ];
    for (const code of cases) {
      expect(writeMatches(code)).toEqual([]);
    }
  });

  test('FP: minimal-payload auth events do not match', () => {
    expect(
      writeMatches(`posthog.capture('login_success', { provider: 'google' })`),
    ).toEqual([]);
  });

  test('FP: benign `location` (page section) property does not match', () => {
    expect(
      writeMatches(`posthog.capture('cta_clicked', { location: 'hero' })`),
    ).toEqual([]);
  });

  test('FP: PII inside $set does not match — it is the remediation we ask for', () => {
    // The runtime notes tell the agent to move PII off the event and onto the
    // person via identify()/$set; matching $set sent agents in circles.
    const cases = [
      `posthog.capture('signup', { $set: { email: user.email } })`,
      `posthog.people.set({ email: user.email })`,
    ];
    for (const code of cases) {
      expect(writeMatches(code)).toEqual([]);
    }
  });

  test('FP: substrings of benign keys do not match', () => {
    expect(
      writeMatches(`posthog.capture('form_submitted', { emailFieldCount: 2 })`),
    ).toEqual([]);
  });
});

describe('hardcoded_posthog_host', () => {
  test('matches a bare host literal', () => {
    const cases = [
      `posthog.init(key, { api_host: 'https://us.i.posthog.com' })`,
      `const host = "https://eu.i.posthog.com";`,
    ];
    for (const code of cases) {
      expect(writeMatches(code)).toContain('hardcoded_posthog_host');
    }
  });

  test('FP: host literal in fallback position does not match', () => {
    const cases = [
      `const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';`,
      `api_host: import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com',`,
      `host = os.environ.get('POSTHOG_HOST') or 'https://us.i.posthog.com'`,
    ];
    for (const code of cases) {
      expect(writeMatches(code)).toEqual([]);
    }
  });
});
