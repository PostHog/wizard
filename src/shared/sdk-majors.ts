/**
 * The per-SDK allowlist of capture modes: which major of each server-side and
 * mobile SDK speaks the legacy capture API and which speaks capture v1.
 *
 * The wizard never lets an agent pick an SDK major. The row for an SDK decides
 * the major a fresh install pins to and the mode an installed major means, so
 * the install, the reference content and the prompt always agree.
 *
 * `v1Released` flips to true in the wizard PR for that SDK's release day. Until
 * then a fresh install stays on `legacyMajor`, whatever the registry's latest is.
 */
import { Integration } from './constants';

export type SdkCaptureMode = 'legacy' | 'v1';

export type SdkId =
  | 'posthog-python'
  | 'posthog-node'
  | 'posthog-go'
  | 'posthog-rs'
  | 'posthog-ios'
  | 'posthog-android'
  | 'posthog-flutter';

export type SdkEcosystem =
  | 'pypi'
  | 'npm'
  | 'go'
  | 'cargo'
  | 'spm'
  | 'maven'
  | 'pub';

/**
 * How an integration that installs this SDK beside its main one treats the row.
 * `follow-table`: the same resolution as a primary install. `legacy-until-flipped`:
 * legacy until the integration's own docs and wrapper packages move, when the
 * entry changes to `follow-table`.
 */
export type SdkSecondaryPolicy = 'follow-table' | 'legacy-until-flipped';

export interface SdkMajorRow {
  /** Stable id used in facts, telemetry and skill-menu variants. */
  readonly sdk: SdkId;
  readonly ecosystem: SdkEcosystem;
  /** Registry names per mode. They differ only where the major changes the name (Go's module path). */
  readonly packages: {
    readonly legacy: readonly string[];
    readonly v1: readonly string[];
  };
  /** Highest legacy major the wizard may install. */
  readonly legacyMajor: number;
  /** First major that speaks capture v1. */
  readonly firstV1Major: number;
  /** True once the v1 major is published and its docs and skills are live. */
  readonly v1Released: boolean;
  /** Integrations whose main SDK this is. */
  readonly primaryIntegrations: readonly Integration[];
  /** Integrations that install this SDK beside another one, with how each treats the row. */
  readonly secondary: Readonly<
    Partial<Record<Integration, SdkSecondaryPolicy>>
  >;
}

const SSR_FRAMEWORKS_ON_LEGACY_NODE: Readonly<
  Partial<Record<Integration, SdkSecondaryPolicy>>
> = {
  [Integration.nextjs]: 'legacy-until-flipped',
  [Integration.nuxt]: 'legacy-until-flipped',
  [Integration.astro]: 'legacy-until-flipped',
  [Integration.sveltekit]: 'legacy-until-flipped',
  [Integration.tanstackStart]: 'legacy-until-flipped',
  [Integration.reactRouter]: 'legacy-until-flipped',
};

export const SDK_MAJORS: readonly SdkMajorRow[] = Object.freeze([
  {
    sdk: 'posthog-python',
    ecosystem: 'pypi',
    packages: { legacy: ['posthog'], v1: ['posthog'] },
    legacyMajor: 7,
    firstV1Major: 8,
    v1Released: false,
    primaryIntegrations: [
      Integration.python,
      Integration.django,
      Integration.flask,
      Integration.fastapi,
    ],
    secondary: {},
  },
  {
    sdk: 'posthog-node',
    ecosystem: 'npm',
    packages: { legacy: ['posthog-node'], v1: ['posthog-node'] },
    legacyMajor: 5,
    firstV1Major: 6,
    v1Released: false,
    primaryIntegrations: [Integration.javascriptNode],
    secondary: SSR_FRAMEWORKS_ON_LEGACY_NODE,
  },
  {
    sdk: 'posthog-go',
    ecosystem: 'go',
    packages: {
      legacy: ['github.com/posthog/posthog-go'],
      v1: ['github.com/posthog/posthog-go/v2'],
    },
    legacyMajor: 1,
    firstV1Major: 2,
    v1Released: false,
    primaryIntegrations: [Integration.go],
    secondary: {},
  },
  {
    sdk: 'posthog-rs',
    ecosystem: 'cargo',
    packages: { legacy: ['posthog-rs'], v1: ['posthog-rs'] },
    legacyMajor: 0,
    firstV1Major: 1,
    v1Released: false,
    primaryIntegrations: [Integration.rust],
    secondary: {},
  },
  {
    sdk: 'posthog-ios',
    ecosystem: 'spm',
    packages: {
      legacy: ['https://github.com/PostHog/posthog-ios'],
      v1: ['https://github.com/PostHog/posthog-ios'],
    },
    legacyMajor: 3,
    firstV1Major: 4,
    v1Released: false,
    primaryIntegrations: [Integration.swift],
    secondary: {},
  },
  {
    sdk: 'posthog-android',
    ecosystem: 'maven',
    packages: {
      legacy: ['com.posthog:posthog-android'],
      v1: ['com.posthog:posthog-android'],
    },
    legacyMajor: 3,
    firstV1Major: 4,
    v1Released: false,
    primaryIntegrations: [Integration.android],
    secondary: {},
  },
  {
    sdk: 'posthog-flutter',
    ecosystem: 'pub',
    packages: { legacy: ['posthog_flutter'], v1: ['posthog_flutter'] },
    legacyMajor: 5,
    firstV1Major: 6,
    v1Released: false,
    primaryIntegrations: [Integration.flutter],
    secondary: {},
  },
] as const satisfies readonly SdkMajorRow[]);

export const SDK_IDS: readonly SdkId[] = SDK_MAJORS.map((row) => row.sdk);

export function isSdkId(value: unknown): value is SdkId {
  return (
    typeof value === 'string' && (SDK_IDS as readonly string[]).includes(value)
  );
}

/** The row for an SDK. `table` exists for tests that need a row in another release state. */
export function getSdkMajorRow(
  sdk: SdkId,
  table: readonly SdkMajorRow[] = SDK_MAJORS,
): SdkMajorRow {
  const row = table.find((candidate) => candidate.sdk === sdk);
  if (!row) throw new Error(`No SDK major row for ${sdk}`);
  return row;
}

/** The SDK rows an integration touches: its main SDK, if allowlisted, and any it installs beside it. */
export function sdkRowsForIntegration(integration: Integration): {
  primary: SdkMajorRow | undefined;
  secondary: readonly SdkMajorRow[];
} {
  return {
    primary: SDK_MAJORS.find((row) =>
      row.primaryIntegrations.includes(integration),
    ),
    secondary: SDK_MAJORS.filter((row) => integration in row.secondary),
  };
}

/** The major a mode installs: `legacyMajor` or `firstV1Major`. */
export function majorForMode(row: SdkMajorRow, mode: SdkCaptureMode): number {
  return mode === 'v1' ? row.firstV1Major : row.legacyMajor;
}

/** The mode an installed major speaks. Any major at or past `firstV1Major` is v1. */
export function modeForInstalledMajor(
  row: SdkMajorRow,
  major: number,
): SdkCaptureMode {
  return major >= row.firstV1Major ? 'v1' : 'legacy';
}
