/**
 * NodeBlock — Renders static JSX, fires onComplete immediately.
 * The sequencer's blockInterval handles dwell time.
 */

import { useEffect, type ReactNode } from 'react';

interface NodeBlockProps {
  content: ReactNode;
  active: boolean;
  onComplete: () => void;
}

export const NodeBlock = ({ content, active, onComplete }: NodeBlockProps) => {
  useEffect(() => {
    if (active) onComplete();
  }, [active, onComplete]);

  return <>{content}</>;
};
