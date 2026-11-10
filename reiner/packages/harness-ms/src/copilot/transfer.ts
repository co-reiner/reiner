/**
 * @file Copilot's own `onedrive` reply mode: what the model is told, and fetching the patch it saved from
 * OneDrive's page.
 * @see {@link ../../docs/file-exchange.md#reply-modes | Copilot file exchange: reply modes}
 * @see {@link ../../docs/file-exchange.md#missing-folders | Copilot file exchange: missing folders}
 */
import type { TransferMode } from '@co-reiner/exchange-packs';
import { createdFolder, fetchCreatedFiles } from './drive.ts';
import { downloadFromReply } from './page-files.ts';
import type { CopilotState } from './state.ts';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The patch files a reply names. OneDrive renames a file saved under a name already taken
 * (`<name>.zip.docx` becomes `<name>.zip <number>.docx`), and Copilot then names the renamed file, so both
 * forms count.
 */
export function namedPatches(markdown: string, project: string): string[] {
  const named = new RegExp(`${escapeRegExp(project)}\\.patch\\.\\d{3}\\.zip(?: \\d+)?\\.docx`, 'gi');
  return [...new Set(markdown.match(named) ?? [])];
}

/**
 * Copilot saves files it creates to the user's OneDrive; Reiner fetches them through OneDrive's page. The
 * reply names the patch (`<project>.patch.<NNN>.zip.docx`), and that name is what is looked for: first as a
 * file card in the reply (downloaded through its own menu), then in the OneDrive folder.
 */
export function onedriveMode(st: CopilotState): TransferMode {
  const folder = createdFolder(st);
  return {
    id: 'onedrive',
    label: 'patch saved to OneDrive',
    description: `The model saves a .zip.docx patch as a file it creates (OneDrive ${folder}); Reiner downloads it through OneDrive in the browser.`,
    instructions: [
      `When I ask for changes to project files, create \`NAME.patch.NUMBER.zip.docx\` as a file for me (it is saved to OneDrive, in ${folder}) and name it in your reply.`,
      '',
      '- It is a ZIP archive with a `.docx` ending, containing only changed and newly added files, with paths relative to the project root.',
      '- Files to remove go in the `#To delete (only to a bin):` block, not in the ZIP.',
    ],
    async collect(reply, ctx) {
      const names = namedPatches(reply.markdown, ctx.project);
      if (!names.length) return { files: [], notes: [] };
      const status = ctx.onStatus ? { onStatus: ctx.onStatus } : {};
      // The reply's own file card has a Download item: quicker than OneDrive's page, which stays the fallback.
      const fromCards = await downloadFromReply(st, ctx.incomingDir, {
        names,
        waitMs: 2000,
        ...status,
      }).catch(() => ({ files: [] as string[], names: [] as string[] }));
      const rest = names.filter((n) => !fromCards.names.includes(n));
      if (!rest.length) return { files: fromCards.files, notes: [] };
      const got = await fetchCreatedFiles(st, rest, ctx.incomingDir, status);
      const notes: string[] = [];
      if (got.missing)
        notes.push(`The OneDrive folder ${folder} does not exist yet. Run /transfer onedrive to set it up.`);
      if (got.notFound.length)
        notes.push(`Not found in OneDrive yet: ${got.notFound.join(', ')}. Try /apply in a moment.`);
      return { files: [...fromCards.files, ...got.files], notes };
    },
  };
}
