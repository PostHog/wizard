/**
 * Session-scoped secret vault.
 *
 * Tools that handle sensitive values (personal API keys pasted by the user
 * or minted by the wizard, OAuth tokens, etc.) store them here and return
 * an opaque `secret:<uuid>` ref to the agent. The agent passes the ref
 * around to subsequent tools — `set_env_values` resolves it host-side
 * before writing — but the raw value never enters the LLM conversation.
 *
 * The vault is created once per `createWizardToolsServer` call and lives
 * for the duration of a single wizard run. There is no persistence and
 * no cross-session sharing; refs minted in one run cannot be resolved in
 * another.
 */

import { randomUUID } from 'crypto';

const REF_PREFIX = 'secret:';

export interface SecretMeta {
  /** Opaque reference handed to the agent. */
  ref: string;
  /** Human-readable label shown to the user (e.g. "Personal API key"). */
  label: string;
  /** Where the secret came from (e.g. "wizard_ask"). */
  source: string;
  /** ms epoch when the secret was stored. */
  createdAt: number;
}

export interface SecretVault {
  /** Store a value and return its ref. */
  put(value: string, meta: Omit<SecretMeta, 'ref' | 'createdAt'>): string;
  /** Resolve a ref to its value, or undefined if unknown. */
  get(ref: string): string | undefined;
  /** Whether the vault knows about this ref. */
  has(ref: string): boolean;
  /** Metadata for every stored secret (never the values). */
  list(): SecretMeta[];
  /** Drop every secret. Call at session teardown. */
  clear(): void;
}

/** True when the value looks like a secret ref. Does not assert resolvability. */
export function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(REF_PREFIX);
}

export function createSecretVault(): SecretVault {
  const store = new Map<string, { value: string; meta: SecretMeta }>();

  return {
    put(value, meta) {
      const ref = `${REF_PREFIX}${randomUUID()}`;
      store.set(ref, {
        value,
        meta: {
          ref,
          label: meta.label,
          source: meta.source,
          createdAt: Date.now(),
        },
      });
      return ref;
    },
    get(ref) {
      return store.get(ref)?.value;
    },
    has(ref) {
      return store.has(ref);
    },
    list() {
      return [...store.values()].map((s) => s.meta);
    },
    clear() {
      store.clear();
    },
  };
}
