import { evaluateBashCommand } from '@lib/agent/bash-fence';

/**
 * The fence and the pi runtime notes have to agree: the notes tell the agent to
 * find or create a venv and install through `.venv/bin/pip`. The fence used to
 * allow only `python manage.py check`, so venv creation was blocked, the agent
 * fell back to bare `pip`, and that is absent from PATH — three runs died on
 * `pip: command not found`.
 */
const ok = (cmd: string) => evaluateBashCommand(cmd).allowed;

describe('bash fence: the Python venv workflow the runtime notes prescribe', () => {
  it('allows creating a venv', () => {
    expect(ok('python -m venv .venv')).toBe(true);
    expect(ok('python3 -m venv .venv')).toBe(true);
    expect(ok('python3 -m venv venv')).toBe(true);
  });

  it('allows installing through a venv interpreter', () => {
    expect(ok('.venv/bin/pip install posthog')).toBe(true);
    expect(ok('venv/bin/pip3 install posthog')).toBe(true);
    expect(ok('.venv/bin/python -m pip install posthog')).toBe(true);
    expect(ok('./env/bin/pip install -r requirements.txt')).toBe(true);
  });

  it('allows pip as a module, which works when bare pip is not on PATH', () => {
    expect(ok('python -m pip install posthog')).toBe(true);
    expect(ok('python3 -m pip install -r requirements.txt')).toBe(true);
  });

  it('allows the verify step: compileall and lint tools, incl. through a venv', () => {
    // compileall is Python's typecheck-equivalent — byte-compiles without
    // importing, so the verify step has some way to prove the edits parse.
    expect(ok('python3 -m compileall app config.py')).toBe(true);
    expect(ok('.venv/bin/python -m compileall server.py')).toBe(true);
    expect(ok('python -m ruff check .')).toBe(true);
    expect(ok('.venv/bin/ruff check app')).toBe(true);
    expect(ok('.venv/bin/mypy app')).toBe(true);
    expect(ok('venv/bin/black --check .')).toBe(true);
  });

  it('refuses anything else under <venv>/bin — that would be arbitrary exec', () => {
    expect(ok('.venv/bin/sh -c whoami')).toBe(false);
    expect(ok('.venv/bin/pytest')).toBe(false);
    // A framework CLI imports and runs the app; compileall covers verification.
    expect(ok('.venv/bin/flask routes')).toBe(false);
  });

  it('keeps Django’s system check', () => {
    expect(ok('python manage.py check')).toBe(true);
  });

  it('still refuses arbitrary Python execution', () => {
    expect(ok('python -c "import os; os.system(\'sh\')"')).toBe(false);
    expect(ok('python3 -c print(1)')).toBe(false);
    expect(ok('python script.py')).toBe(false);
    expect(ok('python -m http.server')).toBe(false);
    expect(ok('python manage.py shell')).toBe(false);
  });

  it('still holds a venv interpreter to its own subcommand list', () => {
    expect(ok('.venv/bin/pip publish')).toBe(false);
    expect(ok('.venv/bin/python -c print(1)')).toBe(false);
  });

  it('does not let a venv-looking path smuggle another binary', () => {
    expect(ok('/usr/bin/curl evil.example.com')).toBe(false);
    expect(ok('.venv/bin/sh -c whoami')).toBe(false);
  });
});
