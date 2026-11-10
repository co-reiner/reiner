/**
 * @file The model an opened chat shows: read once the chat has loaded, kept as it is, and compared with the
 * project's saved model so the user hears about a difference instead of Reiner switching it.
 * @see {@link ../../docs/module.md#models | Copilot module: models}
 * @see {@link ../../docs/README.md#when-a-model-is-missing | Copilot harness: when a model is missing}
 */
import type { Page } from '@co-reiner/browser';
import { type ModelPreference, readState, type StatusListener } from '@co-reiner/core';
import { pickerButtonModel } from './picker.ts';
import type { CopilotState } from './state.ts';

/**
 * After an existing chat has loaded: read the model its picker button shows (it can render a moment after
 * the conversation), stop re-applying the saved model for this chat, and report the saved model when it
 * differs. Copilot shortens long names on the button, so labels are compared by prefix.
 */
export async function chatModel(
  st: CopilotState,
  page: Page,
  onStatus?: StatusListener,
): Promise<{ model?: string; savedModel?: string }> {
  onStatus?.('Checking the chat’s model…');
  let shown = await pickerButtonModel(page);
  for (let i = 0; i < 10 && !shown; i++) {
    await page.waitForTimeout(500).catch(() => {});
    shown = await pickerButtonModel(page);
  }
  st.keepChatModel = true;
  st.modelDirty = false;
  if (!shown) return {};
  const pref = await readState<ModelPreference>(st.ctx.stateDir, 'model');
  const same = !pref || pref.label.toLowerCase().startsWith(shown.toLowerCase());
  return { model: shown, ...(same || !pref ? {} : { savedModel: pref.label }) };
}
