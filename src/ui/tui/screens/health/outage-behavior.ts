export function canContinueBlockingOutage({
  isGithubReleasesDown,
  signup,
}: {
  isGithubReleasesDown: boolean;
  signup: boolean;
}): boolean {
  return signup || !isGithubReleasesDown;
}
