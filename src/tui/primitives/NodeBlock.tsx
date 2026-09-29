/**
 * NodeBlock — Renders static JSX, fires onComplete immediately.
 * The sequencer's blockInterval handles dwell time.
 */

import { Text } from 'ink';
import { useEffect, type ReactNode } from 'react';

interface NodeBlockProps {
  content: ReactNode;
  active: boolean;
  completed: boolean;
  onComplete: () => void;
}

export const NodeBlock = ({
  content,
  active,
  completed,
  onComplete,
}: NodeBlockProps) => {
  useEffect(() => {
    if (active) onComplete();
  }, [active, onComplete]);

  if (completed) return <Text dimColor>{content}</Text>;
  return <>{content}</>;
};
