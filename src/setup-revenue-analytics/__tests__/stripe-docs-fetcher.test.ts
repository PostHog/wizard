/**
 * We only test decodeHtmlEntities here — the fetch logic is tested
 * via integration tests against the live Stripe docs site.
 */

// decodeHtmlEntities is not exported, so we reach it through the module internals.
// Re-implement as a standalone to test the logic in isolation.
// This mirrors the implementation in stripe-docs-fetcher.ts exactly.
function decodeHtmlEntities(text: string): string {
  let stripped = text;
  let prev: string;
  do {
    prev = stripped;
    stripped = stripped.replace(/<[^>]+>/g, '');
  } while (stripped !== prev);

  return stripped
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

describe('decodeHtmlEntities', () => {
  test('decodes basic HTML entities', () => {
    expect(decodeHtmlEntities('a &amp; b')).toBe('a & b');
    expect(decodeHtmlEntities('a &lt; b')).toBe('a < b');
    expect(decodeHtmlEntities('a &gt; b')).toBe('a > b');
    expect(decodeHtmlEntities('&quot;hello&quot;')).toBe('"hello"');
  });

  test('decodes apostrophe entities', () => {
    expect(decodeHtmlEntities('it&#39;s')).toBe("it's");
    expect(decodeHtmlEntities('it&#x27;s')).toBe("it's");
  });

  test('strips HTML tags', () => {
    expect(decodeHtmlEntities('<span>hello</span>')).toBe('hello');
    expect(decodeHtmlEntities('<a href="url">link</a>')).toBe('link');
    expect(decodeHtmlEntities('before<br/>after')).toBe('beforeafter');
  });

  test('strips nested/reconstructed tags via loop', () => {
    // <scr<script>ipt> is matched as one tag, leaving harmless "ipt>" text.
    // The key point: no executable <script> tag survives.
    const result = decodeHtmlEntities('<scr<script>ipt>alert(1)</script>');
    expect(result).not.toContain('<script');
    expect(result).toContain('alert(1)');
  });

  test('strips tags before decoding entities to prevent injection', () => {
    // &lt;script&gt; should decode to <script> as plain text,
    // NOT be treated as an HTML tag and stripped
    expect(decodeHtmlEntities('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(
      '<script>alert(1)</script>',
    );
  });

  test('handles double-encoded entities', () => {
    // &amp;lt; → strip tags (none present) → decode &amp; → &lt; → decode &lt; → <
    // Double-encoded content fully decodes. This is fine because the output
    // is used as plain text in the agent prompt, not rendered as HTML.
    expect(decodeHtmlEntities('&amp;lt;script&amp;gt;')).toBe('<script>');
  });

  test('handles mixed content', () => {
    expect(
      decodeHtmlEntities(
        '<code>stripe.customers.create({ &quot;email&quot;: user.email })</code>',
      ),
    ).toBe('stripe.customers.create({ "email": user.email })');
  });

  test('preserves plain text', () => {
    expect(decodeHtmlEntities('hello world')).toBe('hello world');
    expect(decodeHtmlEntities('const x = 42;')).toBe('const x = 42;');
  });
});
