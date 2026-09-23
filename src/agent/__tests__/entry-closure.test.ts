import { staticImportClosure } from '../../../test/module-graph';

describe('@agent entry closure', () => {
  // The CLI's startup chunk imports @agent, so its static imports load before any work.
  it('loads only leaf data at startup; the runner, agent interface and tools load on first call', () => {
    const agentFiles = staticImportClosure('src/agent/index.ts').filter(
      (file) => file.startsWith('src/agent/'),
    );
    expect(agentFiles).toEqual([
      'src/agent/default-binding.ts',
      'src/agent/index.ts',
      'src/agent/progress.ts',
      'src/agent/runner/shared/types.ts',
      'src/agent/runner/switchboard/resolve-harness.ts',
      'src/agent/signals.ts',
      'src/agent/tools/tool-names.ts',
    ]);
  });
});
