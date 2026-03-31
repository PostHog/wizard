/**
 * PromptSyncScreen — interactive prompt sync flow.
 *
 * Phases:
 *   Fetching → SelectClients → SelectScope → InputDirName → SelectPrompts → Syncing → Done
 *
 * CLI flags can bypass individual phases. When all are provided, the flow
 * runs non-interactively.
 */

import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useState, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { type WizardStore } from '../store.js';
import { PickerMenu, GroupedPickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';
import type {
  PromptSyncer,
  PromptSyncAuth,
  PromptDiff,
  PromptSyncResult,
} from '../services/prompt-syncer.js';
import type { ApiPrompt } from '../../../lib/api.js';
import {
  type PromptSyncClient,
  DEFAULT_DIR_NAME,
} from '../../../steps/sync-prompts/prompt-sync-client.js';

interface PromptSyncScreenProps {
  store: WizardStore;
  syncer: PromptSyncer;
  standalone?: boolean;
}

enum Phase {
  Fetching = 'fetching',
  SelectClients = 'select-clients',
  SelectScope = 'select-scope',
  InputDirName = 'input-dir-name',
  SelectPrompts = 'select-prompts',
  Syncing = 'syncing',
  Done = 'done',
  Error = 'error',
}

export const PromptSyncScreen = ({
  store,
  syncer,
  standalone = false,
}: PromptSyncScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const session = store.session;

  const [phase, setPhase] = useState<Phase>(Phase.Fetching);
  const [auth, setAuth] = useState<PromptSyncAuth | null>(null);
  const [prompts, setPrompts] = useState<ApiPrompt[]>([]);
  const [selectedClients, setSelectedClients] = useState<PromptSyncClient[]>(
    [],
  );
  const [isGlobal, setIsGlobal] = useState(session.promptSyncGlobal ?? false);
  const [dirName, setDirName] = useState(
    session.promptSyncDirName ?? DEFAULT_DIR_NAME,
  );
  const [diffs, setDiffs] = useState<PromptDiff[]>([]);
  const [results, setResults] = useState<PromptSyncResult[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const markDone = () => {
    store.setPromptSyncComplete();
    if (standalone) {
      process.exit(0);
    }
  };

  // Phase: Fetching — auth + fetch prompts on mount
  useEffect(() => {
    void (async () => {
      try {
        const resolvedAuth = await syncer.resolveAuth(session.apiKey);
        setAuth(resolvedAuth);
        const fetched = await syncer.fetchPrompts(resolvedAuth);

        if (fetched.length === 0) {
          setErrorMsg('No prompts found for this team.');
          setPhase(Phase.Error);
          return;
        }

        setPrompts(fetched);

        const cliClients = session.promptSyncClients;
        if (cliClients) {
          const clients = syncer.getClients(cliClients);
          setSelectedClients(clients);

          if (session.promptSyncAll) {
            doSync(
              fetched,
              resolvedAuth.teamId,
              clients,
              session.promptSyncGlobal ?? false,
              session.promptSyncDirName ?? DEFAULT_DIR_NAME,
            );
          } else {
            advanceFromClients(clients, fetched, session.promptSyncGlobal);
          }
        } else {
          setPhase(Phase.SelectClients);
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Authentication failed';
        setErrorMsg(msg);
        setPhase(Phase.Error);
        if (standalone) {
          setTimeout(() => process.exit(1), 2000);
        }
      }
    })();
  }, [syncer]); // eslint-disable-line

  const advanceFromClients = (
    clients: PromptSyncClient[],
    fetchedPrompts: ApiPrompt[],
    globalOverride?: boolean,
  ) => {
    setSelectedClients(clients);
    if (globalOverride !== undefined) {
      setIsGlobal(globalOverride);
      advanceFromScope(clients, fetchedPrompts, globalOverride);
    } else {
      setPhase(Phase.SelectScope);
    }
  };

  const advanceFromScope = (
    clients: PromptSyncClient[],
    fetchedPrompts: ApiPrompt[],
    global: boolean,
  ) => {
    if (session.promptSyncDirName) {
      advanceFromDirName(
        clients,
        fetchedPrompts,
        global,
        session.promptSyncDirName,
      );
    } else {
      setPhase(Phase.InputDirName);
    }
  };

  const advanceFromDirName = (
    clients: PromptSyncClient[],
    fetchedPrompts: ApiPrompt[],
    global: boolean,
    dir: string,
  ) => {
    if (session.promptSyncAll) {
      doSync(fetchedPrompts, auth!.teamId, clients, global, dir);
    } else {
      const promptDiffs = syncer.diffPrompts(
        fetchedPrompts,
        clients,
        global,
        dir,
      );

      // Sort: updated → new → unchanged, alphabetical within each group
      const statusOrder: Record<string, number> = {
        updated: 0,
        new: 1,
        unchanged: 2,
      };
      promptDiffs.sort((a, b) => {
        const orderDiff = statusOrder[a.status] - statusOrder[b.status];
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name);
      });

      setDiffs(promptDiffs);
      setPhase(Phase.SelectPrompts);
    }
  };

  const doSync = (
    promptsToSync: ApiPrompt[],
    teamId: number,
    clients: PromptSyncClient[],
    global: boolean,
    dir: string,
  ) => {
    setPhase(Phase.Syncing);
    const syncResults = syncer.sync(
      promptsToSync,
      teamId,
      clients,
      global,
      dir,
    );
    setResults(syncResults);
    setPhase(Phase.Done);
    setTimeout(markDone, 2000);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Prompt Sync
      </Text>

      <Box marginTop={1} flexDirection="column">
        {phase === Phase.Fetching && (
          <Text dimColor>Authenticating and fetching prompts…</Text>
        )}

        {phase === Phase.Error && (
          <>
            <Text color="red">{errorMsg}</Text>
            <Box marginTop={1}>
              <Text dimColor>
                Exiting in 2 seconds…
              </Text>
            </Box>
          </>
        )}

        {phase === Phase.SelectClients && (
          <PickerMenu
            message="Select editors to sync prompts to"
            options={[
              { label: 'Claude Code', value: 'claude-code' },
              { label: 'Cursor', value: 'cursor' },
            ]}
            mode="multi"
            onSelect={(selected) => {
              const slugs = Array.isArray(selected) ? selected : [selected];
              const clients = syncer.getClients(slugs);
              advanceFromClients(clients, prompts);
            }}
          />
        )}

        {phase === Phase.SelectScope && (
          <PickerMenu
            message="Where should prompts be synced?"
            options={[
              {
                label: 'Project (local directory)',
                value: 'local',
              },
              {
                label: 'Global (home directory)',
                value: 'global',
              },
            ]}
            onSelect={(scope) => {
              const global = scope === 'global';
              setIsGlobal(global);
              advanceFromScope(selectedClients, prompts, global);
            }}
          />
        )}

        {phase === Phase.InputDirName && (
          <Box flexDirection="column">
            <Text>Directory name for synced prompts:</Text>
            <Box marginTop={1}>
              <TextInput
                defaultValue={dirName}
                placeholder="posthog-prompts"
                onSubmit={(value) => {
                  const dir = value.trim() || DEFAULT_DIR_NAME;
                  setDirName(dir);
                  advanceFromDirName(selectedClients, prompts, isGlobal, dir);
                }}
              />
            </Box>
          </Box>
        )}

        {phase === Phase.SelectPrompts && (() => {
          const groups: Record<string, { value: string; label: string }[]> = {};
          const preSelected: string[] = [];

          for (const d of diffs) {
            let groupLabel: string;
            if (d.status === 'updated') {
              groupLabel = 'Updated';
              preSelected.push(d.name);
            } else if (d.status === 'new') {
              groupLabel = 'New';
              preSelected.push(d.name);
            } else if (d.status === 'removed') {
              // Removed prompts aren't shown in the picker — they'll
              // be cleaned up automatically during sync.
              continue;
            } else {
              groupLabel = 'Unchanged';
              preSelected.push(d.name);
            }
            if (!groups[groupLabel]) groups[groupLabel] = [];
            groups[groupLabel].push({ value: d.name, label: d.name });
          }

          return (
            <GroupedPickerMenu
              message="Select prompts to sync"
              groups={groups}
              initialSelected={preSelected}
              onSelect={(selected) => {
                const filtered = prompts.filter((p) =>
                  selected.includes(p.name),
                );
                doSync(filtered, auth!.teamId, selectedClients, isGlobal, dirName);
              }}
            />
          );
        })()}

        {phase === Phase.Syncing && <Text dimColor>Syncing prompts…</Text>}

        {phase === Phase.Done && (
          <Box flexDirection="column">
            <Text color="green" bold>
              {'\u2714'} Prompts synced:
            </Text>
            {results.map((r, i) => {
              const parts: string[] = [];
              if (r.written > 0) parts.push(`${r.written} written`);
              if (r.removed > 0) parts.push(`${r.removed} removed`);
              if (r.unchanged > 0) parts.push(`${r.unchanged} unchanged`);
              if (r.failed > 0) parts.push(`${r.failed} failed`);
              return (
                <Text key={i}>
                  {' \u2022 '}
                  {r.client}: {parts.join(', ')} \u2192 {r.targetDir}
                </Text>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
};
