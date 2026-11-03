/**
 * What PostHog SDK a project already has, per ecosystem: the lockfile's
 * resolved copies first, the manifest's requirement second. Bounded file reads
 * only; nothing here runs a package manager.
 */
import type { InstalledSdk } from '@shared/sdk-capture-mode';
import type { SdkEcosystem, SdkId } from '@shared/sdk-majors';
import { getSdkMajorRow } from '@shared/sdk-majors';
import { readCargoInstalls } from './cargo';
import { readGoInstalls } from './go';
import { readMavenInstalls } from './maven';
import { readNpmInstalls } from './npm';
import { readPubInstalls } from './pub';
import { readPypiInstalls } from './pypi';
import { readSpmInstalls } from './spm';
import type { InstalledSdkReader } from './types';

const READERS: Record<SdkEcosystem, InstalledSdkReader> = {
  npm: readNpmInstalls,
  pypi: readPypiInstalls,
  go: readGoInstalls,
  cargo: readCargoInstalls,
  pub: readPubInstalls,
  spm: readSpmInstalls,
  maven: readMavenInstalls,
};

/** Every copy of `sdk` the project declares or has resolved; empty for a fresh install. */
export function readInstalledSdks(
  installDir: string,
  sdk: SdkId,
): Promise<InstalledSdk[]> {
  return Promise.resolve(READERS[getSdkMajorRow(sdk).ecosystem](installDir));
}

export type { InstalledSdk };
