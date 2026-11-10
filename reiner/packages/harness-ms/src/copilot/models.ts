/**
 * @file Listing the models Copilot offers and selecting one, saved so it can be re-applied after page loads.
 * @see {@link ../../docs/module.md#models | Copilot module: models}
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@co-reiner/browser';
import {
  type ModelInfo,
  type ModelListResult,
  type ModelPreference,
  matchModels,
  type SelectModelResult,
  type StatusListener,
  writeState,
} from '@co-reiner/core';
import { ready } from './browser.ts';
import { clickPath, readPicker } from './picker.ts';
import { type CopilotState, now } from './state.ts';

export async function listModels(
  st: CopilotState,
  opts: { debug?: boolean; onStatus?: StatusListener } = {},
): Promise<ModelListResult> {
  const notes: string[] = [];
  const { page, signIn } = await ready(st, notes, opts.onStatus);
  if (!signIn.signedIn) {
    return { signIn, models: [], source: 'none', notes: [signIn.reason] } satisfies ModelListResult;
  }
  opts.onStatus?.('Reading the model picker…');
  const before = opts.debug ? await snapshot(page) : '';
  const models = await readPicker(page, notes);
  const after = opts.debug ? await snapshot(page) : '';

  const result: ModelListResult =
    models.length > 0
      ? { signIn, models, source: 'picker', notes }
      : {
          signIn,
          models: [],
          source: 'none',
          notes: [
            ...notes,
            'No model picker found. Copilot may not offer a model choice to this account, or the ' +
              'selectors need updating. Run `/models --debug` and check the dump in .reiner/logs/.',
          ],
        };
  if (opts.debug) result.debugFile = await writeDebugDump(st.ctx.logDir, page, { before, after, result });
  await writeState(st.ctx.stateDir, 'models', result);
  return result;
}

export async function selectModel(
  st: CopilotState,
  query: string,
  opts: { onStatus?: StatusListener } = {},
): Promise<SelectModelResult> {
  const notes: string[] = [];
  const { page, signIn } = await ready(st, notes, opts.onStatus);
  const done = (result: Omit<SelectModelResult, 'signIn' | 'notes'>): SelectModelResult => ({
    signIn,
    notes,
    ...result,
  });
  if (!signIn.signedIn) {
    notes.push(signIn.reason);
    return done({ status: 'signed-out', candidates: [], models: [] });
  }

  opts.onStatus?.('Reading the model picker…');
  const models = await readPicker(page, []);
  if (models.length === 0) {
    notes.push('No model picker found on the page.');
    return done({ status: 'not-found', candidates: [], models });
  }
  await writeState(st.ctx.stateDir, 'models', { signIn, models, source: 'picker', notes: [] });

  const candidates = matchModels(models, query);
  if (candidates.length === 0) return done({ status: 'not-found', candidates, models });
  if (candidates.length > 1) return done({ status: 'ambiguous', candidates, models });
  const model = candidates[0] as ModelInfo;

  const remember = () =>
    writeState(st.ctx.stateDir, 'model', {
      id: model.id,
      label: model.label,
      ...(model.group ? { group: model.group } : {}),
      ...(model.path ? { path: model.path } : {}),
      chosenAt: now(),
    } satisfies ModelPreference);

  if (model.selected) {
    await remember();
    return done({ status: 'already', model, candidates, models });
  }

  opts.onStatus?.(`Selecting ${model.group ? `${model.group} › ` : ''}${model.label}…`);
  const clicked = await clickPath(page, model.path ?? [model.label]);
  opts.onStatus?.('Checking the picker shows the new model…');
  const after = clicked ? await readPicker(page, []) : [];
  if (after.find((m) => m.id === model.id)?.selected !== true) {
    notes.push(
      clicked
        ? 'Clicked the model, but the picker does not show it as selected.'
        : 'Could not click through the picker to that model.',
    );
    return done({ status: 'failed', model, candidates, models: after.length ? after : models });
  }
  await remember();
  await writeState(st.ctx.stateDir, 'models', { signIn, models: after, source: 'picker', notes: [] });
  return done({ status: 'selected', model: { ...model, selected: true }, candidates, models: after });
}

async function snapshot(page: Page): Promise<string> {
  return page
    .locator('body')
    .ariaSnapshot({ timeout: 5000 })
    .catch((e: unknown) => `(snapshot failed: ${String(e)})`);
}

async function writeDebugDump(
  logDir: string,
  page: Page,
  data: { before: string; after: string; result: ModelListResult },
): Promise<string> {
  const popupButtons = await page
    .locator('button[aria-haspopup]')
    .evaluateAll((els) =>
      els.map(
        (el) => `${el.getAttribute('aria-label') ?? ''} | ${(el.textContent ?? '').trim().slice(0, 60)}`,
      ),
    )
    .catch(() => [] as string[]);
  const u = new URL(page.url());
  const file = path.join(logDir, `models-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  const text = [
    '# reiner models debug dump',
    '',
    'Local only. May contain your chat titles and name. Do not share without reading it first.',
    '',
    `- Page: ${u.origin}${u.pathname}`,
    `- Source: ${data.result.source}, models found: ${data.result.models.length}`,
    '',
    '## Buttons that open popups (aria-label | text)',
    '',
    ...popupButtons.map((b) => `- ${b}`),
    '',
    '## Accessibility snapshot before opening the picker',
    '',
    '```yaml',
    data.before,
    '```',
    '',
    '## Accessibility snapshot after',
    '',
    '```yaml',
    data.after,
    '```',
    '',
  ].join('\n');
  await writeFile(file, text, 'utf8');
  return file;
}
