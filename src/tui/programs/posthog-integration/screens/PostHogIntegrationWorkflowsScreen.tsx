/**
 * PostHogIntegrationWorkflowsScreen — offers the draft workflows the run's
 * workflows step designed on the events it added, as one checklist. Shown after
 * the outro, where the user is still present, rather than mid-run. Each ticked
 * workflow is created as a draft that sends nothing until turned on.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { WizardStore } from '@tui/store';
import { Colors, Icons } from '@tui/styles';
import { PickerMenu, LoadingBox } from '@tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@tui/hooks/useKeyBindings';
import {
  createWorkflowDrafts,
  emailSenderSetupUrl,
  getWorkflowProposals,
  withoutExistingWorkflows,
  WORKFLOW_GOALS,
  type WorkflowDraftResult,
  type WorkflowProposal,
} from '@programs/posthog-integration';
import { analytics } from '@utils/analytics';

interface PostHogIntegrationWorkflowsScreenProps {
  store: WizardStore;
}

type Phase = 'loading' | 'pick' | 'creating' | 'done';

function benefit(proposal: WorkflowProposal): string {
  return proposal.goal
    ? `${WORKFLOW_GOALS[proposal.goal]} · ${proposal.reason}`
    : proposal.reason;
}

export const PostHogIntegrationWorkflowsScreen = ({
  store,
}: PostHogIntegrationWorkflowsScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const credentials = store.session.credentials;
  const [proposals, setProposals] = useState<WorkflowProposal[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [results, setResults] = useState<WorkflowDraftResult[]>([]);

  // Offer only what the project does not already have; nothing left ends the step.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const all = getWorkflowProposals(store.session);
    const offered = credentials
      ? withoutExistingWorkflows(credentials, all)
      : Promise.resolve(all);
    void offered.then((kept) => {
      if (kept.length === 0) {
        store.setWorkflowsStepDone();
        return;
      }
      analytics.wizardCapture('workflows proposals shown', {
        proposal_count: kept.length,
        goals: kept.map((p) => p.goal ?? 'none'),
      });
      setProposals(kept);
      setPhase('pick');
    });
  }, [store, credentials]);

  const answer = (picked: WorkflowProposal[]): void => {
    analytics.wizardCapture('workflows proposals answered', {
      proposal_count: proposals.length,
      selected_count: picked.length,
      selected_goals: picked.map((p) => p.goal ?? 'none'),
    });
    if (!credentials || picked.length === 0) {
      store.setWorkflowsStepDone();
      return;
    }
    setPhase('creating');
    void createWorkflowDrafts(credentials, picked).then((created) => {
      setResults(created);
      setPhase('done');
    });
  };

  const handlePick = (value: number | number[]): void => {
    const indexes = Array.isArray(value) ? value : [value];
    answer(indexes.map((i) => proposals[i]));
  };

  useKeyBindings('integration-workflows', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: phase === 'done' ? 'continue' : 'skip',
      handler: () => {
        if (phase === 'creating') return;
        if (phase === 'done') store.setWorkflowsStepDone();
        else answer([]);
      },
    },
  ]);

  if (phase === 'loading' || phase === 'creating') {
    return (
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <LoadingBox
          message={
            phase === 'loading'
              ? 'Checking your workflows...'
              : 'Creating draft workflows...'
          }
        />
      </Box>
    );
  }

  if (phase === 'done') {
    const created = results.filter((r) => 'url' in r).length;
    return (
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <Text bold color={created > 0 ? Colors.success : Colors.accent}>
          {created > 0 ? `${Icons.check} ` : ''}
          {`Created ${created} of ${results.length} draft workflows`}
        </Text>
        {results.map((result) => (
          <Box key={result.title} marginTop={1} flexDirection="column">
            <Text bold>{result.title}</Text>
            {'url' in result ? (
              <Text color="cyan">{result.url}</Text>
            ) : (
              <Text dimColor>
                {`Could not create it: ${result.error}. You can build it in PostHog under Workflows.`}
              </Text>
            )}
          </Box>
        ))}
        {created > 0 && credentials && (
          <Box marginTop={1} flexDirection="column">
            <Text>
              Each one is a draft. It can send only once your project has a
              verified email sender. Set one up, or check yours:
            </Text>
            <Text color="cyan">{emailSenderSetupUrl(credentials)}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <PickerMenu
            options={[{ label: 'Continue', value: 'continue' }]}
            onSelect={() => store.setWorkflowsStepDone()}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginTop={1} flexDirection="column">
        <Text bold color={Colors.accent}>
          Workflows for your events
        </Text>
        <Box marginTop={1}>
          <Text>
            Based on the events we added, these workflows can help you. Untick
            any you do not want and we create the rest in PostHog as drafts. A
            draft sends nothing until you turn it on.
          </Text>
        </Box>
        <Box marginTop={1}>
          <PickerMenu<number>
            mode="multi"
            initialSelected={proposals.map((_, i) => i)}
            options={proposals.map((proposal, i) => ({
              label: proposal.title,
              value: i,
              description: benefit(proposal),
            }))}
            onSelect={handlePick}
          />
        </Box>
      </Box>
    </Box>
  );
};
