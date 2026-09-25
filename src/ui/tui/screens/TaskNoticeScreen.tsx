/**
 * TaskNoticeScreen — Modal shown before an optional step runs.
 *
 * Some steps stop to ask the user for something. This tells them so before the
 * step starts, and lets them decline it. The copy comes from the program that
 * owns the step; this screen only renders what it is given.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { Colors } from '@ui/tui/styles';
import { ConfirmationInput, ModalOverlay } from '@ui/tui/primitives/index';

interface TaskNoticeScreenProps {
  store: WizardStore;
}

export const TaskNoticeScreen = ({ store }: TaskNoticeScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const notice = store.session.taskNotice;
  if (!notice) return null;

  return (
    <ModalOverlay
      borderColor={Colors.primary}
      title={notice.title}
      width={76}
      footer={
        <ConfirmationInput
          message={notice.prompt}
          confirmLabel={notice.confirmLabel}
          cancelLabel={notice.cancelLabel}
          onConfirm={() => store.resolveTaskNotice(true)}
          onCancel={() => store.resolveTaskNotice(false)}
        />
      }
    >
      <Box flexDirection="column" gap={1}>
        {notice.body.map((paragraph) => (
          <Text key={paragraph}>{paragraph}</Text>
        ))}
      </Box>
      {notice.items && notice.items.length > 0 && (
        <Box marginTop={1} paddingLeft={2}>
          <Text bold>{notice.items.join(', ')}</Text>
        </Box>
      )}
      {notice.docsUrl && (
        <Box marginTop={1}>
          <Text dimColor>
            {notice.docsLabel ?? 'Learn more'}: {notice.docsUrl}
          </Text>
        </Box>
      )}
    </ModalOverlay>
  );
};
