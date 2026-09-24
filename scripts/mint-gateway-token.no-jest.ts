import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import { gatewayAuth } from '@agent/gateway-session';
import { HostResolution } from '@shared/host-resolution';
import { getOAuthScopesForProgram } from '@lib/oauth/program-scopes';
import type { ProgramId } from '@lib/programs/program-registry';
import { performOAuthFlow } from '@utils/oauth';

const program = process.env.PROGRAM as ProgramId | undefined;
const projectId = Number(process.env.PROJECT_ID);
const tokenFile = process.env.TOKEN_FILE
  ? path.resolve(process.env.TOKEN_FILE)
  : undefined;

if (
  !program ||
  !Number.isSafeInteger(projectId) ||
  projectId <= 0 ||
  !tokenFile
) {
  console.error('PROGRAM, PROJECT_ID, and TOKEN_FILE are required.');
  process.exit(2);
}

function refuseNonRegularDestination(destinationPath: string): void {
  const destinationStat = fs.lstatSync(destinationPath, {
    throwIfNoEntry: false,
  });
  if (destinationStat && !destinationStat.isFile()) {
    throw new Error(`Refusing non-regular destination: ${destinationPath}`);
  }
}

function refuseUnsafeParentDirectory(directoryPath: string): void {
  const directoryStat = fs.lstatSync(directoryPath);
  const isOwnedByCurrentUser = directoryStat.uid === process.getuid?.();
  const isWritableByOthers = (directoryStat.mode & 0o022) !== 0;
  if (
    !directoryStat.isDirectory() ||
    !isOwnedByCurrentUser ||
    isWritableByOthers
  ) {
    throw new Error(`Refusing unsafe destination directory: ${directoryPath}`);
  }
}

function refuseUnsafeAncestorDirectory(directoryPath: string): void {
  const directoryStat = fs.lstatSync(directoryPath);
  const isOwnedByTrustedAccount =
    directoryStat.uid === process.getuid?.() || directoryStat.uid === 0;
  const isWritableByOthers = (directoryStat.mode & 0o022) !== 0;
  const hasStickyBit = (directoryStat.mode & 0o1000) !== 0;
  if (
    !directoryStat.isDirectory() ||
    !isOwnedByTrustedAccount ||
    (isWritableByOthers && !hasStickyBit)
  ) {
    throw new Error(`Refusing unsafe ancestor directory: ${directoryPath}`);
  }
}

function refuseUnsafeDirectoryChain(parentDirectoryPath: string): void {
  refuseUnsafeParentDirectory(parentDirectoryPath);
  let childPath = parentDirectoryPath;
  let ancestorPath = path.dirname(parentDirectoryPath);
  while (ancestorPath !== childPath) {
    refuseUnsafeAncestorDirectory(ancestorPath);
    childPath = ancestorPath;
    ancestorPath = path.dirname(ancestorPath);
  }
}

function writePrivateFileAtomically(
  destinationPath: string,
  contents: string,
): void {
  const tempPath = `${destinationPath}.tmp-${process.pid}-${randomBytes(
    6,
  ).toString('hex')}`;
  const fileDescriptor = fs.openSync(
    tempPath,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeSync(fileDescriptor, contents, null, 'utf8');
    fs.fchmodSync(fileDescriptor, 0o600);
    fs.closeSync(fileDescriptor);
    fs.renameSync(tempPath, destinationPath);
  } catch (writeError) {
    fs.rmSync(tempPath, { force: true });
    throw writeError;
  }
}

const tokenResponse = await performOAuthFlow({
  scopes: [...getOAuthScopesForProgram(program)],
  projectId,
});
const host = await HostResolution.fromAccessToken(tokenResponse.access_token, {
  region: tokenResponse.posthog_region,
});
const auth = await gatewayAuth(host, tokenResponse.access_token, program);

if (auth.teamId !== projectId) {
  console.error(
    `Requested project ${projectId}, but the token was minted for project ${
      auth.teamId ?? 'unknown'
    }. Nothing was written.`,
  );
  process.exit(1);
}

const sidecarFile = `${tokenFile}.json`;
const tokenDirectory = path.dirname(tokenFile);
fs.mkdirSync(tokenDirectory, { recursive: true, mode: 0o700 });
refuseUnsafeDirectoryChain(tokenDirectory);
refuseNonRegularDestination(tokenFile);
refuseNonRegularDestination(sidecarFile);
writePrivateFileAtomically(tokenFile, auth.token);
writePrivateFileAtomically(
  sidecarFile,
  JSON.stringify({
    program,
    projectId: auth.teamId,
    gatewayUrl: auth.gatewayUrl,
    refreshAtMs: auth.refreshAtMs,
    tokenSha256: createHash('sha256').update(auth.token, 'utf8').digest('hex'),
  }),
);
console.log(`minted gateway token for ${program} -> ${tokenFile}`);
process.exit(0);
