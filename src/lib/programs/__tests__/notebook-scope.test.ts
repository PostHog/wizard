import {
  NOTEBOOK_WRITE_SCOPE,
  notebookUploadSkipInstruction,
} from '@lib/programs/audit/notebook-scope';

describe('notebookUploadSkipInstruction', () => {
  it('returns null when the grant includes notebook:write', () => {
    expect(notebookUploadSkipInstruction([])).toBeNull();
    expect(notebookUploadSkipInstruction(['dashboard:write'])).toBeNull();
    expect(notebookUploadSkipInstruction(undefined)).toBeNull();
  });

  it('steers the agent to skip the upload when notebook:write is missing', () => {
    const instruction = notebookUploadSkipInstruction([NOTEBOOK_WRITE_SCOPE]);

    expect(instruction).not.toBeNull();
    // Names the tool the agent must not call and the check it must resolve.
    expect(instruction).toContain('notebooks-create');
    expect(instruction).toContain('upload-notebook');
    // Keeps the local report and points the user at re-authorization.
    expect(instruction).toContain('report is the deliverable');
    expect(instruction).toContain('Re-run the wizard');
  });
});
