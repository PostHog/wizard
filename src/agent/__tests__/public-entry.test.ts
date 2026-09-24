describe('@agent public entry', () => {
  it('exports only the agent contract and its data', async () => {
    const entry = await import('@agent');
    expect(Object.keys(entry).sort()).toEqual([
      'AgentSignals',
      'DEFAULT_AGENT_BINDING',
      'OutroKind',
      'RunOutcome',
      'TASK_OUTCOMES_KEY',
      'WIZARD_TOOL_NAMES',
      'downloadSkill',
      'harnessRunsTasks',
      'resolveHarness',
      'runAgent',
      'runMcpPromptViaSdk',
    ]);
  });
});
