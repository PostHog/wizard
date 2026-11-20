import { Box, Text } from 'ink';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WizardStore } from '@tui/store';
import { Colors } from '@tui/styles';
import { PickerMenu } from '@tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@tui/hooks/useKeyBindings';
import { useDismissOnAnyKey } from '@tui/hooks/useDismissOnAnyKey';
import { useScreenVisible } from '@tui/hooks/useScreenVisible';
import {
  emailSetupCommand,
  type EmailSetup,
} from '@tui/programs/posthog-integration/email-setup-command';
import {
  EmailProviderOfferAnswer,
  emailProviderOffer,
  reportEmailProviderOfferAnswered,
  reportEmailProviderOfferShown,
  type EmailProviderOffer,
} from '@programs/posthog-integration';

interface EmailProviderOfferScreenProps {
  store: WizardStore;
}

export const EmailProviderOfferScreen = ({
  store,
}: EmailProviderOfferScreenProps) => {
  const [offer] = useState(() => emailProviderOffer(store.session));

  useEffect(() => {
    if (!offer) store.setEmailProviderOfferDone();
  }, [offer, store]);

  if (!offer) return null;
  return <OfferFlow offer={offer} store={store} />;
};

function useAnswerOnce(offer: EmailProviderOffer, visible: boolean) {
  const shown = useRef(false);
  const answered = useRef(false);

  useEffect(() => {
    if (!visible || shown.current) return;
    shown.current = true;
    reportEmailProviderOfferShown(offer);
  }, [offer, visible]);

  useEffect(
    () => () => {
      if (!shown.current || answered.current) return;
      reportEmailProviderOfferAnswered(offer, EmailProviderOfferAnswer.Skipped);
    },
    [offer],
  );

  return (answer: EmailProviderOfferAnswer): boolean => {
    if (!shown.current || answered.current) return false;
    answered.current = true;
    reportEmailProviderOfferAnswered(offer, answer);
    return true;
  };
}

const OfferFlow = ({
  offer,
  store,
}: {
  offer: EmailProviderOffer;
  store: WizardStore;
}) => {
  const visible = useScreenVisible();
  const [setup, setSetup] = useState<EmailSetup | null>(null);
  const answerOnce = useAnswerOnce(offer, visible);

  const answer = (choice: EmailProviderOfferAnswer): void => {
    if (!answerOnce(choice)) return;
    if (choice !== EmailProviderOfferAnswer.Yes) {
      store.setEmailProviderOfferDone();
      return;
    }
    const accepted = {
      ...emailSetupCommand(offer),
      workflowsUrl: offer.workflowsUrl,
    };
    store.setEmailSetup(accepted);
    setSetup(accepted);
  };

  if (setup) {
    return (
      <WorkflowsLink
        setup={setup}
        migrateCommand={offer.migrateCommand}
        visible={visible}
        onContinue={() => store.setEmailProviderOfferDone()}
      />
    );
  }

  return <QuestionPicker visible={visible} onAnswer={answer} />;
};

// Longer than a held key's first repeat on default desktop settings, so an Enter held from the previous screen can't answer yes unread.
const QUESTION_READ_GUARD_MS = 1000;

const QUESTION =
  "PostHog can send this app's transactional emails directly from code, " +
  'with delivery and engagement events next to your product analytics. ' +
  'Want to try it?';

const CHOICES = [
  { label: 'Yes, show me how', value: EmailProviderOfferAnswer.Yes },
  { label: 'Not now', value: EmailProviderOfferAnswer.NotNow },
  { label: 'No thanks', value: EmailProviderOfferAnswer.No },
];

const QuestionPicker = ({
  visible,
  onAnswer,
}: {
  visible: boolean;
  onAnswer: (choice: EmailProviderOfferAnswer) => void;
}) => {
  const quietSince = useRef(Date.now());
  // A layout effect, so an Enter on the first frame the question shows again already meets the reset.
  useLayoutEffect(() => {
    quietSince.current = Date.now();
  }, [visible]);

  const answerAfterPause = (choice: EmailProviderOfferAnswer): void => {
    const now = Date.now();
    const paused = now - quietSince.current >= QUESTION_READ_GUARD_MS;
    quietSince.current = now;
    if (paused) onAnswer(choice);
  };

  useKeyBindings(
    'email-provider-offer',
    [
      {
        match: KeyMatch.Escape,
        label: 'esc',
        action: 'skip',
        handler: () => onAnswer(EmailProviderOfferAnswer.Skipped),
      },
    ],
    { active: visible },
  );

  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1}>
      <Text>{QUESTION}</Text>
      <Box marginTop={1}>
        <PickerMenu
          options={CHOICES}
          active={visible}
          onSelect={(value) =>
            answerAfterPause(Array.isArray(value) ? value[0] : value)
          }
        />
      </Box>
    </Box>
  );
};

const WorkflowsLink = ({
  setup,
  migrateCommand,
  visible,
  onContinue,
}: {
  setup: EmailSetup;
  migrateCommand?: string;
  visible: boolean;
  onContinue: () => void;
}) => {
  useDismissOnAnyKey(() => {
    if (visible) onContinue();
  });

  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1}>
      <Text>{setup.lead}</Text>
      <Text bold>{setup.command}</Text>
      <Box marginTop={1}>
        <Text>
          Or set up email in Workflows:{' '}
          <Text color="cyan">{setup.workflowsUrl}</Text>
        </Text>
      </Box>
      {migrateCommand && (
        <Box marginTop={1}>
          <Text>
            Move your existing emails with <Text bold>{migrateCommand}</Text>
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to exit</Text>
      </Box>
    </Box>
  );
};
