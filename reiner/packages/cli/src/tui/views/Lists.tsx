/**
 * @file Transcript views for lists: chats, file changes and the file-exchange settings.
 * @see {@link ../../../../../docs/architecture/file-exchange.md#applying-changes | File exchange: applying changes}
 * @see {@link ../../../../exchange-packs/docs/packs.md#inbound-reply-modes | File exchange: reply modes}
 */
import type { HarnessModule } from '@co-reiner/core';
import { Box, Text } from 'ink';
import type { Entry } from '../entries.ts';
import { hasCommand } from '../hints.ts';
import { ACCENT } from './theme.ts';

type Of<K extends Entry['kind']> = Extract<Entry, { kind: K }>;

/** /chats: the harness's recent chats, numbered for /chat <number>. */
export function ChatsView({ entry, module }: { entry: Of<'chats'>; module: HarnessModule | null }) {
  // Only the commands this harness has are offered.
  const hints = [
    hasCommand(module, 'chat') ? '/chat <name or number> switches' : '',
    hasCommand(module, 'rename') ? '/rename <title>' : '',
    hasCommand(module, 'delete') ? '/delete [name]' : '',
  ].filter(Boolean);
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {entry.chats.length === 0 ? (
        <Text color="gray">No chats in the recent list.</Text>
      ) : (
        entry.chats.map((c, i) => (
          <Text key={c.id}>
            <Text color="gray">{String(i + 1).padStart(2)}. </Text>
            <Text color={c.current ? 'green' : 'white'}>{c.title || c.id}</Text>
            {c.agent ? <Text color="gray"> (agent)</Text> : null}
            {c.current ? <Text color="green"> (open)</Text> : null}
          </Text>
        ))
      )}
      {hints.length ? <Text color="gray">{hints.join(' · ')}</Text> : null}
    </Box>
  );
}

/** File changes found in a reply, before the y/N. */
export function ChangesView({ entry }: { entry: Of<'changes'> }) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text bold>
        Changes in <Text color={ACCENT}>{entry.source}</Text>
      </Text>
      {entry.items.map((item) => (
        <Text key={`${item.action}:${item.path}`}>
          <Text color={item.action === 'delete' ? 'red' : item.action === 'write' ? 'green' : 'yellow'}>
            {item.action === 'delete' ? '  − ' : item.action === 'write' ? '  + ' : '  ~ '}
          </Text>
          {item.path}
        </Text>
      ))}
    </Box>
  );
}

/** /transfer and /instructions overviews: lines starting with ● are highlighted. */
export function TransferView({ entry }: { entry: Of<'transfer'> }) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text bold>File exchange</Text>
      {entry.lines.map((line) => (
        <Text key={line} color={line.startsWith('●') ? 'green' : 'gray'}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
