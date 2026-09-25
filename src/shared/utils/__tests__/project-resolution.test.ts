import { resolveGrantedProject } from '@utils/project-resolution';

describe('resolveGrantedProject', () => {
  // The main integration flow (and every other program) runs without --project-id;
  // this case must stay identical to the pre-flag behavior: use scoped_teams[0].
  it('uses the granted project when no --project-id is passed', () => {
    expect(resolveGrantedProject(undefined, [123, 456])).toEqual({
      ok: true,
      projectId: 123,
    });
  });

  it('returns no project when nothing is granted and no --project-id is passed', () => {
    expect(resolveGrantedProject(undefined, [])).toEqual({
      ok: true,
      projectId: undefined,
    });
    expect(resolveGrantedProject(undefined, undefined)).toEqual({
      ok: true,
      projectId: undefined,
    });
  });

  it('honors --project-id when the user granted access to it', () => {
    expect(resolveGrantedProject(456, [123, 456])).toEqual({
      ok: true,
      projectId: 456,
    });
  });

  it('flags a mismatch when a different project was authorized', () => {
    expect(resolveGrantedProject(456, [123])).toEqual({
      ok: false,
      requested: 456,
      granted: 123,
    });
  });

  it('defers to the no-access guard when --project-id is passed but nothing was granted', () => {
    expect(resolveGrantedProject(456, [])).toEqual({
      ok: true,
      projectId: undefined,
    });
    expect(resolveGrantedProject(456, undefined)).toEqual({
      ok: true,
      projectId: undefined,
    });
  });
});
