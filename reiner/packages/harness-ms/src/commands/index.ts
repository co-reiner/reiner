/**
 * @file Builds the slash command list for a chat harness such as Copilot.
 * @see {@link ../../docs/commands.md | Copilot's slash commands}
 * @see {@link ../../../../docs/architecture/modules.md#harness-commands | Harness modules: harness commands}
 */
import type { HarnessCommand } from '@co-reiner/core';
import { applyCommand } from './apply.ts';
import { chatCommand } from './chat.ts';
import { chatsCommand } from './chats.ts';
import { deleteCommand } from './delete.ts';
import { historyCommand } from './history.ts';
import { instructionsCommand } from './instructions.ts';
import { loginCommand } from './login.ts';
import { modelCommand } from './model.ts';
import { modelsCommand } from './models.ts';
import { newCommand } from './new.ts';
import { packCommand } from './pack.ts';
import { renameCommand } from './rename.ts';
import { transferCommand } from './transfer.ts';
import type { ChatHarness } from './types.ts';

export type { ChatHarness, PackHarness } from './types.ts';

/** The slash commands of a chat harness such as Copilot, in the order /help lists them. */
export function chatHarnessCommands(self: ChatHarness): HarnessCommand[] {
  return [
    loginCommand,
    newCommand,
    chatsCommand,
    chatCommand,
    historyCommand,
    renameCommand,
    deleteCommand,
    transferCommand,
    instructionsCommand,
    packCommand,
    applyCommand,
    modelsCommand,
    modelCommand,
  ].map((make) => make(self));
}
