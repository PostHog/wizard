import { Box, Text, measureElement } from 'ink';
import { useRef, useState, useEffect } from 'react';

interface DividerProps {
  dimColor?: boolean;
  char?: string;
}

export const Divider = ({ dimColor = true, char = '─' }: DividerProps) => {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (ref.current) {
      const { width: measured } = measureElement(ref.current);
      setWidth(measured);
    }
  }, []);

  return (
    <Box ref={ref} width="100%">
      <Text dimColor={dimColor}>{width > 0 ? char.repeat(width) : ''}</Text>
    </Box>
  );
};
