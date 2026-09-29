vi.mock(import('@tui/auth/project-data'), () => ({
  getOrAskForProjectData: vi.fn(),
}));

import { MCP_TUTORIAL_SCOPE_ADDITIONS, Tool } from '@tools';
import { getOrAskForProjectData } from '@tui/auth/project-data';
import { HostResolution } from '@shared/host-resolution';
import { WizardStore } from '@tui/store';
import { createMcpSuggestedPromptsServices } from '../services/suggested-prompts';

// Without them the tutorial's prompts 403 on every product surface they demo.
it("logs the tutorial in with the tutorial's scope additions", async () => {
  vi.mocked(getOrAskForProjectData).mockResolvedValue({
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectApiKey: 'phc_tutorial',
    accessToken: 'pha_tutorial',
    projectId: 3,
    roleAtOrganization: null,
    user: null,
    project: null,
    missingScopes: [],
  });
  const store = new WizardStore(Tool.McpTutorial);

  await createMcpSuggestedPromptsServices(store).performLogin();

  expect(getOrAskForProjectData).toHaveBeenCalledWith(
    expect.objectContaining({ scopeAdditions: MCP_TUTORIAL_SCOPE_ADDITIONS }),
  );
});
