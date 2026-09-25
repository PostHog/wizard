import { createSecretVault, isSecretRef } from '../secret-vault';

describe('createSecretVault', () => {
  it('stores a value and returns a ref', () => {
    const vault = createSecretVault();
    const ref = vault.put('phx_super_secret', {
      label: 'PostHog key',
      source: 'test',
    });

    expect(isSecretRef(ref)).toBe(true);
    expect(ref).toMatch(/^secret:[0-9a-f-]{36}$/);
    expect(vault.has(ref)).toBe(true);
    expect(vault.get(ref)).toBe('phx_super_secret');
  });

  it('mints a fresh ref per put even for the same value', () => {
    const vault = createSecretVault();
    const a = vault.put('same-value', { label: 'A', source: 'test' });
    const b = vault.put('same-value', { label: 'B', source: 'test' });

    expect(a).not.toBe(b);
    expect(vault.get(a)).toBe('same-value');
    expect(vault.get(b)).toBe('same-value');
  });

  it('returns undefined for unknown refs', () => {
    const vault = createSecretVault();
    expect(vault.get('secret:does-not-exist')).toBeUndefined();
    expect(vault.has('secret:does-not-exist')).toBe(false);
  });

  it('list() returns metadata only, never values', () => {
    const vault = createSecretVault();
    vault.put('value-1', { label: 'one', source: 'src-a' });
    vault.put('value-2', { label: 'two', source: 'src-b' });

    const metas = vault.list();
    expect(metas).toHaveLength(2);
    expect(metas.map((m) => m.label).sort()).toEqual(['one', 'two']);
    expect(metas.map((m) => m.source).sort()).toEqual(['src-a', 'src-b']);
    // Ensure no `value` key bled into the metadata
    for (const m of metas) {
      expect(m).not.toHaveProperty('value');
    }
  });

  it('clear() drops every secret', () => {
    const vault = createSecretVault();
    const ref = vault.put('gone', { label: 'temp', source: 'test' });
    vault.clear();
    expect(vault.has(ref)).toBe(false);
    expect(vault.get(ref)).toBeUndefined();
    expect(vault.list()).toEqual([]);
  });

  it('isolates vault instances from each other', () => {
    const a = createSecretVault();
    const b = createSecretVault();
    const ref = a.put('only-in-a', { label: 'a-only', source: 'test' });

    expect(a.has(ref)).toBe(true);
    expect(b.has(ref)).toBe(false);
  });

  it('isSecretRef recognises refs and rejects garbage', () => {
    expect(isSecretRef('secret:abc')).toBe(true);
    expect(isSecretRef('not a ref')).toBe(false);
    expect(isSecretRef('')).toBe(false);
    expect(isSecretRef(null)).toBe(false);
    expect(isSecretRef(undefined)).toBe(false);
    expect(isSecretRef({ secretRef: 'secret:abc' })).toBe(false);
  });
});
