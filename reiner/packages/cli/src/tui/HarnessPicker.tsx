/**
 * @file The first-run harness picker.
 * @see {@link ../../../../docs/architecture/cli-ux.md#startup | CLI and TUI: startup}
 * @see {@link ../../../../docs/architecture/overview.md#harnesses-and-the-live-browser | Architecture overview: harnesses and the live browser}
 */
import type { HarnessEntry } from '@co-reiner/core';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

/** First-run choice of harness: ↑/↓ to move, Enter to pick. */
export function HarnessPicker({
  harnesses,
  onPick,
}: {
  harnesses: HarnessEntry[];
  onPick: (id: string) => void | Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState(false);

  useInput((_char, key) => {
    if (picked) return;
    if (key.upArrow) setIndex((i) => (i - 1 + harnesses.length) % harnesses.length);
    else if (key.downArrow) setIndex((i) => (i + 1) % harnesses.length);
    else if (key.return) {
      const choice = harnesses[index];
      if (!choice) return;
      setPicked(true);
      void onPick(choice.id);
    }
  });

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Which harness should this project use?</Text>
      <Text color="gray">You can add or switch harnesses later with /harness.</Text>
      <Text> </Text>
      {harnesses.map((h, i) => (
        <Text key={h.id}>
          <Text color={i === index ? 'cyan' : 'gray'}>{i === index ? '❯ ' : '  '}</Text>
          <Text color={i === index ? 'white' : 'gray'}>{h.displayName}</Text>
          <Text color="gray"> · {h.description}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text color="gray">↑/↓ to choose · Enter to confirm</Text>
    </Box>
  );
}
