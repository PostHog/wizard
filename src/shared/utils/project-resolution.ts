export type GrantedProjectResolution =
  | { ok: true; projectId: number | undefined }
  | { ok: false; requested: number; granted: number };

/**
 * Decide which project to use after OAuth. `--project-id` (when passed) is authoritative,
 * but only when the user granted access to it on the consent screen; a different grant is a
 * mismatch the caller must surface. With no `--project-id` this returns the granted project
 * (`scopedTeams[0]`), preserving the pre-flag behavior for every wizard program (the main
 * integration flow included).
 */
export function resolveGrantedProject(
  requestedProjectId: number | undefined,
  scopedTeams: number[] | undefined,
): GrantedProjectResolution {
  // No --project-id: use whatever the user granted, exactly as before the flag existed.
  if (requestedProjectId === undefined) {
    return { ok: true, projectId: scopedTeams?.[0] };
  }
  // --project-id was among the granted teams: honor it.
  if (scopedTeams?.includes(requestedProjectId)) {
    return { ok: true, projectId: requestedProjectId };
  }
  // --project-id requested but a different project was authorized: mismatch.
  if (scopedTeams && scopedTeams.length > 0) {
    return {
      ok: false,
      requested: requestedProjectId,
      granted: scopedTeams[0],
    };
  }
  // Nothing granted at all — let the caller's "no project access" guard handle it.
  return { ok: true, projectId: undefined };
}
