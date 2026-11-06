import { Box, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { WizardStore } from '@tui/store';
import { Colors } from '@tui/styles';
import { PickerMenu } from '@tui/primitives/index';
import { useKeyBindings, KeyMatch } from '@tui/hooks/useKeyBindings';
import { useDismissOnAnyKey } from '@tui/hooks/useDismissOnAnyKey';
import {
  EmailProviderOfferAnswer,
  emailProviderOffer,
  emailProviderOfferChoices,
  EMAIL_PROVIDER_OFFER_QUESTION,
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

function useAnswerOnce(offer: EmailProviderOffer) {
  const answered = useRef(false);

  useEffect(() => {
    reportEmailProviderOfferShown(offer);
    return () => {
      if (answered.current) return;
      reportEmailProviderOfferAnswered(offer, EmailProviderOfferAnswer.Skipped);
    };
  }, [offer]);

  return (answer: EmailProviderOfferAnswer): boolean => {
    if (answered.current) return false;
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
  const [showingWorkflows, setShowingWorkflows] = useState(false);
  const answerOnce = useAnswerOnce(offer);

  const answer = (choice: EmailProviderOfferAnswer): void => {
    if (!answerOnce(choice)) return;
    if (choice === EmailProviderOfferAnswer.Yes) setShowingWorkflows(true);
    else store.setEmailProviderOfferDone();
  };

  if (showingWorkflows) {
    return (
      <WorkflowsLink
        offer={offer}
        onContinue={() => store.setEmailProviderOfferDone()}
      />
    );
  }

  return <QuestionPicker onAnswer={answer} />;
};

/**
 * How long the question ignores Enter after it opens. The cursor starts on
 * "Yes", so without it a quick second Enter meant for the outro would answer
 * yes before the question could be read.
 */
export const QUESTION_READ_GUARD_MS = 500;

const QuestionPicker = ({
  onAnswer,
}: {
  onAnswer: (choice: EmailProviderOfferAnswer) => void;
}) => {
  const [openedAt] = useState(() => Date.now());
  useKeyBindings('email-provider-offer', [
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: 'skip',
      handler: () => onAnswer(EmailProviderOfferAnswer.Skipped),
    },
  ]);

  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1}>
      <Text>{EMAIL_PROVIDER_OFFER_QUESTION}</Text>
      <Box marginTop={1}>
        <PickerMenu
          options={emailProviderOfferChoices()}
          onSelect={(value) => {
            if (Date.now() - openedAt < QUESTION_READ_GUARD_MS) return;
            onAnswer(Array.isArray(value) ? value[0] : value);
          }}
        />
      </Box>
    </Box>
  );
};

const WorkflowsLink = ({
  offer,
  onContinue,
}: {
  offer: EmailProviderOffer;
  onContinue: () => void;
}) => {
  useDismissOnAnyKey(onContinue);

  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1}>
      <Text>
        Set up email in Workflows:{' '}
        <Text color="cyan">{offer.workflowsUrl}</Text>
      </Text>
      {offer.migrateCommand && (
        <Box marginTop={1}>
          <Text>
            Move your existing emails with{' '}
            <Text bold>{offer.migrateCommand}</Text>
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to continue</Text>
      </Box>
    </Box>
  );
};
