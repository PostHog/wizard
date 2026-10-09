/**
 * PostHogIntegrationWorkflowsScreen — offers the draft workflows the run's
 * workflows step designed on the events it added. Shown after the outro, where
 * the user is still present, rather than mid-run. Creating them is the user's
 * pick; each one is created as a draft that sends nothing until turned on.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { WizardStore } from '@tui/store';
import { Colors, Icons } from '@tui/styles';
import { PickerMenu, LoadingBox } from '@tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@tui/hooks/useKeyBindings';
import {
  createWorkflowDrafts,
  getWorkflowProposals,
  type WorkflowDraftResult,
  type WorkflowProposal,
} from '@programs/posthog-integration';
import { analytics } from '@utils/analytics';

interface PostHogIntegrationWorkflowsScreenProps {
  store: WizardStore;
}

enum Choice {
  All = 'all',
  Pick = 'pick',
  Skip = 'skip',
}

type Phase = 'choose' | 'pick' | 'creating' | 'done';

export const PostHogIntegrationWorkflowsScreen = ({
  store,
}: PostHogIntegrationWorkflowsScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const proposals = getWorkflowProposals(store.session);
  const credentials = store.session.credentials;
  const [phase, setPhase] = useState<Phase>('choose');
  const [results, setResults] = useState<WorkflowDraftResult[]>([]);

  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    analytics.wizardCapture('workflows proposals shown', {
      proposal_count: proposals.length,
    });
  }, [proposals.length]);

  const answer = (choice: Choice, selected: number): void => {
    analytics.wizardCapture('workflows proposals answered', {
      choice,
      proposal_count: proposals.length,
      selected_count: selected,
    });
  };

  const skip = (): void => {
    answer(Choice.Skip, 0);
    store.setWorkflowsStepDone();
  };

  const create = (picked: WorkflowProposal[]): void => {
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

  const handleChoice = (value: Choice | Choice[]): void => {
    const choice = Array.isArray(value) ? value[0] : value;
    if (choice === Choice.All) {
      answer(Choice.All, proposals.length);
      create(proposals);
    } else if (choice === Choice.Pick) {
      setPhase('pick');
    } else {
      skip();
    }
  };

  const handlePick = (value: number | number[]): void => {
    const indexes = Array.isArray(value) ? value : [value];
    answer(Choice.Pick, indexes.length);
    create(indexes.map((i) => proposals[i]));
  };

  useKeyBindings('integration-workflows', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: phase === 'done' ? 'continue' : 'skip',
      handler: () => {
        if (phase === 'creating') return;
        if (phase === 'done') store.setWorkflowsStepDone();
        else skip();
      },
    },
  ]);

  if (phase === 'creating') {
    return (
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <LoadingBox message="Creating draft workflows..." />
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
        {created > 0 && (
          <Box marginTop={1}>
            <Text>
              Each one is a draft. Add a sender and turn it on in PostHog when
              you are ready.
            </Text>
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
          Draft workflows for your events
        </Text>
        <Box marginTop={1}>
          <Text>
            We designed these email workflows from the events we added. We
            create them as drafts. A draft sends nothing until you add a sender
            and turn it on in PostHog.
          </Text>
        </Box>

        {proposals.map((proposal) => (
          <Box key={proposal.title} marginTop={1} flexDirection="column">
            <Text bold>
              <Text color="cyan">{Icons.diamond} </Text>
              {proposal.title}
            </Text>
            <Text dimColor>{proposal.reason}</Text>
            {proposal.steps.map((step, i) => (
              <Text key={i}>{`  ${i + 1}. ${step}`}</Text>
            ))}
          </Box>
        ))}

        <Box marginTop={1}>
          {phase === 'pick' ? (
            <PickerMenu<number>
              mode="multi"
              message="Pick the workflows to create"
              options={proposals.map((proposal, i) => ({
                label: proposal.title,
                value: i,
              }))}
              onSelect={handlePick}
            />
          ) : (
            <PickerMenu<Choice>
              options={[
                {
                  label:
                    proposals.length === 1
                      ? 'Create it as a draft'
                      : `Create all ${proposals.length} as drafts`,
                  value: Choice.All,
                },
                ...(proposals.length > 1
                  ? [{ label: 'Choose which to create', value: Choice.Pick }]
                  : []),
                { label: 'Skip', value: Choice.Skip },
              ]}
              onSelect={handleChoice}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
};
