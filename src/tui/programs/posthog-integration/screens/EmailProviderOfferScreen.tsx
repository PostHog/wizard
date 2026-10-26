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
  emailProviderOfferQuestion,
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

  return <QuestionPicker offer={offer} onAnswer={answer} />;
};

const QuestionPicker = ({
  offer,
  onAnswer,
}: {
  offer: EmailProviderOffer;
  onAnswer: (choice: EmailProviderOfferAnswer) => void;
}) => {
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
      <Text>{emailProviderOfferQuestion(offer)}</Text>
      <Box marginTop={1}>
        <PickerMenu
          options={emailProviderOfferChoices(offer)}
          onSelect={(value) =>
            onAnswer(Array.isArray(value) ? value[0] : value)
          }
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
            Move your {offer.providerLabels[0]} emails with{' '}
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
