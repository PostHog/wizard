/**
 * HNViewer — Top 10 Hacker News stories.
 *
 * Fetches from the HN Firebase API on mount.
 * Each story has a [1]–[0] numeral; typing it opens the HN comments page.
 */

import { Box, Text, useInput } from 'ink';
import { useState, useEffect } from 'react';
import { Colors } from '../styles.js';

const HN_API = 'https://hacker-news.firebaseio.com/v0';

interface HNStory {
  id: number;
  title: string;
  by: string;
  time: number;
  score: number;
}

export const HNViewer = () => {
  const [stories, setStories] = useState<HNStory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${HN_API}/topstories.json`);
        const ids = (await res.json()) as number[];
        const top10 = ids.slice(0, 10);

        const items = await Promise.all(
          top10.map(async (id) => {
            const r = await fetch(`${HN_API}/item/${id}.json`);
            return r.json() as Promise<HNStory>;
          }),
        );

        setStories(items);
      } catch {
        // Silently fail — tab just stays empty
      }
      setLoading(false);
    })();
  }, []);

  useInput((input) => {
    // Map keys 1–9 → index 0–8, key 0 → index 9
    const num = parseInt(input, 10);
    if (isNaN(num)) return;
    const index = num === 0 ? 9 : num - 1;
    const story = stories[index];
    if (!story) return;

    const url = `https://news.ycombinator.com/item?id=${story.id}`;
    void import('child_process').then(({ exec }) => {
      exec(`open "${url}" 2>/dev/null || xdg-open "${url}" 2>/dev/null`);
    });
  });

  if (loading) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Loading Hacker News...</Text>
      </Box>
    );
  }

  if (stories.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Could not load Hacker News.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={Colors.accent}>
        Hacker News — Top 10
      </Text>
      <Box height={1} />
      {stories.map((story, i) => {
        const key = i === 9 ? '0' : String(i + 1);
        const date = new Date(story.time * 1000);
        const dateStr = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });

        return (
          <Box key={story.id}>
            <Text color={Colors.accent} bold>
              [{key}]{' '}
            </Text>
            <Text>{story.title} </Text>
            <Text dimColor>
              ({story.score}pts, {story.by}, {dateStr})
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
