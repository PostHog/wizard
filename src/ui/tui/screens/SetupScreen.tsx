/**
 * SetupScreen — Generic framework disambiguation.
 *
 * Iterates unresolved setup questions from the FrameworkConfig
 * and renders a PickerMenu for each. If all questions are auto-resolved,
 * this screen is skipped entirely (the router skips it via its show() predicate).
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';
import type { SetupQuestion } from '../../../lib/framework-config.js';

interface SetupScreenProps {
  store: WizardStore;
}

export const SetupScreen = ({ store }: SetupScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const config = store.session.frameworkConfig;
  const questions = config?.metadata.setup?.questions ?? [];

  // Track which question index we're currently showing
  const [currentIndex, setCurrentIndex] = useState(0);
  const [resolving, setResolving] = useState(true);

  // On mount, run auto-detection for all questions
  useEffect(() => {
    void (async () => {
      for (const q of questions) {
        // Skip if already resolved (e.g. by CLI arg)
        if (q.key in store.session.frameworkContext) continue;

        try {
          const detected = await q.detect({
            installDir: store.session.installDir,
          });
          if (detected !== null) {
            store.session.frameworkContext[q.key] = detected;
          }
        } catch {
          // Detection failed — will ask the user
        }
      }
      setResolving(false);

      // If all resolved, advance immediately
      const unresolved = questions.filter(
        (q: SetupQuestion) => !(q.key in store.session.frameworkContext),
      );
      if (unresolved.length === 0) {
        store.emitChange();
      }
    })();
  }, []);

  if (resolving) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text dimColor>Detecting project configuration...</Text>
      </Box>
    );
  }

  // Get unresolved questions
  const unresolved = questions.filter(
    (q: SetupQuestion) => !(q.key in store.session.frameworkContext),
  );

  if (unresolved.length === 0) {
    // All resolved — should have already advanced
    return null;
  }

  const question = unresolved[currentIndex] ?? unresolved[0];
  if (!question) return null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          Project Setup
        </Text>
        {config && (
          <Text dimColor>Configuring {config.metadata.name} integration</Text>
        )}
      </Box>

      <PickerMenu<string>
        message={question.message}
        options={question.options.map((o) => ({
          label: o.label,
          value: o.value,
          hint: o.hint,
        }))}
        onSelect={(value) => {
          const selected = Array.isArray(value) ? value[0] : value;
          store.session.frameworkContext[question.key] = selected;

          // Check if more unresolved questions remain
          const remaining = unresolved.filter(
            (q: SetupQuestion) =>
              q.key !== question.key &&
              !(q.key in store.session.frameworkContext),
          );

          if (remaining.length === 0) {
            store.emitChange();
          } else {
            setCurrentIndex((i) => i + 1);
          }
        }}
      />
    </Box>
  );
};
