import { useEffect, useRef, useState } from 'react';
import { KeyMatch, useKeyBindings } from '../../../hooks/useKeyBindings.js';

interface UseScrollOptions {
  rowCount: number;
  visibleHeight: number;
  hasExpandable: boolean;
  expanded: boolean;
  toggleExpanded: () => void;
}

interface UseScrollResult {
  offset: number;
}

/** Sticky-to-top scroll: viewport tracks offset 0 until the user scrolls down,
 *  then stays where they last left it. */
export function useScroll({
  rowCount,
  visibleHeight,
  hasExpandable,
  expanded,
  toggleExpanded,
}: UseScrollOptions): UseScrollResult {
  const [offset, setOffset] = useState(0);
  const stickyRef = useRef(true);

  const maxOffset = Math.max(0, rowCount - visibleHeight);

  useEffect(() => {
    if (stickyRef.current) {
      setOffset(0);
    } else if (offset > maxOffset) {
      setOffset(maxOffset);
    }
  }, [maxOffset, offset]);

  useKeyBindings('audit-checks-viewer', [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '↑↓',
      action: 'scroll',
      handler: (_input, key) => {
        if (key.upArrow) {
          setOffset((prev) => {
            const next = Math.max(0, prev - 1);
            stickyRef.current = next === 0;
            return next;
          });
        }
        if (key.downArrow) {
          stickyRef.current = false;
          setOffset((prev) => Math.min(maxOffset, prev + 1));
        }
      },
    },
    {
      match: 'u',
      label: 'u',
      action: 'page up',
      handler: () => {
        setOffset((prev) => {
          const next = Math.max(0, prev - visibleHeight);
          stickyRef.current = next === 0;
          return next;
        });
      },
    },
    {
      match: 'd',
      label: 'd',
      action: 'page down',
      handler: () => {
        stickyRef.current = false;
        setOffset((prev) => Math.min(maxOffset, prev + visibleHeight));
      },
    },
    ...(hasExpandable
      ? [
          {
            match: 'e' as const,
            label: 'e',
            action: expanded ? 'collapse details' : 'expand details',
            handler: toggleExpanded,
          },
        ]
      : []),
  ]);

  return { offset };
}
