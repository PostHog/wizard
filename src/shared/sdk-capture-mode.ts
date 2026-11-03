/**
 * Resolves the capture mode a run uses for one SDK, before any agent starts.
 *
 * Pure and deterministic: the caller reads the project and the host and passes
 * what it found. An installed SDK always wins; a run never changes an installed
 * major. A fresh install goes to v1 only when the row is released, the project
 * meets the SDK's floor, the host serves the v1 routes and no flag says
 * otherwise. Everything else is legacy, pinned.
 */
import { Integration, WIZARD_SDK_CAPTURE_V1_FLAG_KEY } from './constants';
import {
  SDK_MAJORS,
  getSdkMajorRow,
  isSdkId,
  majorForMode,
  modeForInstalledMajor,
  type SdkCaptureMode,
  type SdkId,
  type SdkMajorRow,
} from './sdk-majors';

/** One installed copy of an SDK, as a reader found it. */
export interface InstalledSdk {
  readonly major: number;
  /** The version or requirement as written, for the report. */
  readonly version: string;
  /** The file the version came from, for the report. */
  readonly source: string;
  /**
   * A manifest requirement with no upper bound and no lockfile behind it
   * (`posthog>=3.0.0`): the major it installs is whatever the registry serves
   * next, so it does not fix the mode. The run treats it as a fresh install
   * and the pinned install replaces the requirement.
   */
  readonly unbounded?: boolean;
}

export type SdkFloorCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface SdkCaptureModeInput {
  readonly sdk: SdkId;
  /** The run's integration, for the row's secondary policy. */
  readonly integration?: Integration;
  /** Every installed copy the readers found; empty for a fresh install. */
  readonly installed?: readonly InstalledSdk[];
  /** The raw payload of the `wizard-sdk-capture-v1` flag, if any. */
  readonly flagPayload?: unknown;
  /** The SDK's toolchain and platform floor for v1; absent means not checked. */
  readonly floor?: SdkFloorCheck;
  /** Whether the host serves the v1 routes; absent means a cloud host, which does. */
  readonly hostServesV1?: boolean;
}

export type SdkCaptureModeReason =
  | 'installed'
  | 'conflict'
  | 'flag'
  | 'secondary-policy'
  | 'not-released'
  | 'floor'
  | 'host'
  | 'default';

export type SdkCaptureModeResolution =
  | {
      readonly sdk: SdkId;
      readonly mode: SdkCaptureMode;
      /** The major the run installs or found installed. */
      readonly major: number;
      readonly reason: Exclude<SdkCaptureModeReason, 'conflict'>;
      /** The floor that failed, the file an installed copy came from, or the flag value. */
      readonly detail?: string;
      readonly installed: readonly InstalledSdk[];
    }
  | {
      readonly sdk: SdkId;
      /** Two installed copies disagree on the mode; the run stops before the agent edits code. */
      readonly mode: 'conflict';
      readonly reason: 'conflict';
      readonly installed: readonly InstalledSdk[];
    };

export type SdkCaptureModeOverrides = Readonly<
  Partial<Record<SdkId, SdkCaptureMode>>
>;

/**
 * The flag payload is `{ "<sdk>": "legacy" | "v1" }`. Unknown SDK ids and
 * values are dropped, so an unrelated payload on the key overrides nothing.
 */
export function parseSdkCaptureModeOverrides(
  payload: unknown,
): SdkCaptureModeOverrides {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return {};
  }
  const overrides: Partial<Record<SdkId, SdkCaptureMode>> = {};
  for (const [key, value] of Object.entries(
    payload as Record<string, unknown>,
  )) {
    if (!isSdkId(key)) continue;
    if (value !== 'legacy' && value !== 'v1') continue;
    overrides[key] = value;
  }
  return overrides;
}

/** `parseSdkCaptureModeOverrides` over a flag snapshot's payloads. */
export function sdkCaptureModeOverridesFromPayloads(
  payloads: Readonly<Record<string, unknown>> | undefined,
): SdkCaptureModeOverrides {
  return parseSdkCaptureModeOverrides(
    payloads?.[WIZARD_SDK_CAPTURE_V1_FLAG_KEY],
  );
}

export function resolveSdkCaptureMode(
  input: SdkCaptureModeInput,
  table: readonly SdkMajorRow[] = SDK_MAJORS,
): SdkCaptureModeResolution {
  const row = getSdkMajorRow(input.sdk, table);
  const installed = input.installed ?? [];

  const installedResolution = resolveFromInstalled(row, installed);
  if (installedResolution) return installedResolution;

  const fresh = (
    mode: SdkCaptureMode,
    reason: Exclude<SdkCaptureModeReason, 'conflict' | 'installed'>,
    detail?: string,
  ): SdkCaptureModeResolution => ({
    sdk: row.sdk,
    mode,
    major: majorForMode(row, mode),
    reason,
    ...(detail === undefined ? {} : { detail }),
    installed,
  });

  const override = parseSdkCaptureModeOverrides(input.flagPayload)[row.sdk];
  if (override === 'legacy') return fresh('legacy', 'flag', override);

  const secondaryPolicy =
    input.integration === undefined
      ? undefined
      : row.secondary[input.integration];
  if (secondaryPolicy === 'legacy-until-flipped') {
    return fresh('legacy', 'secondary-policy', input.integration);
  }

  if (!row.v1Released && override !== 'v1') {
    return fresh('legacy', 'not-released');
  }

  if (input.floor && !input.floor.ok) {
    return fresh('legacy', 'floor', input.floor.reason);
  }

  if (input.hostServesV1 === false) return fresh('legacy', 'host');

  return override === 'v1'
    ? fresh('v1', 'flag', override)
    : fresh('v1', 'default');
}

function resolveFromInstalled(
  row: SdkMajorRow,
  installed: readonly InstalledSdk[],
): SdkCaptureModeResolution | undefined {
  // An unbounded requirement below the first v1 major fixes nothing; one at or
  // above it is the project's choice of the v1 line.
  const fixed = installed.filter(
    (copy) => !copy.unbounded || copy.major >= row.firstV1Major,
  );
  if (fixed.length === 0) return undefined;

  const modes = new Set(
    fixed.map((copy) => modeForInstalledMajor(row, copy.major)),
  );
  if (modes.size > 1) {
    return { sdk: row.sdk, mode: 'conflict', reason: 'conflict', installed };
  }

  // Copies agree on the mode; the highest major is the one the project builds against.
  const highest = fixed.reduce((best, copy) =>
    copy.major > best.major ? copy : best,
  );
  return {
    sdk: row.sdk,
    mode: modeForInstalledMajor(row, highest.major),
    major: highest.major,
    reason: 'installed',
    detail: highest.source,
    installed,
  };
}
