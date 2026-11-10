/**
 * @file Copilot's model picker: the button's label, reading the menu and its submenus, clicking a model.
 * @see {@link ../../docs/module.md#models | Copilot module: models}
 */
import type { Page } from '@co-reiner/browser';
import type { ModelInfo } from '@co-reiner/core';
import * as S from './selectors.ts';
import type { Locator } from './state.ts';

/**
 * The model name on the picker button, without opening it: "GPT-5.6 Sol Think, Model Selector" gives
 * "GPT-5.6 Sol Think". Copilot shortens long names, so compare by prefix. Undefined if no button is found.
 */
export async function pickerButtonModel(page: Page): Promise<string | undefined> {
  for (const selector of S.MODEL_PICKER) {
    const button = page.locator(selector).first();
    if (!(await button.isVisible().catch(() => false))) continue;
    const label = (await button.getAttribute('aria-label').catch(() => null)) ?? '';
    const name = label.split(',')[0]?.trim();
    if (name) return name;
  }
  return undefined;
}

/** Split an item's visible text into its label (first line) and description (the rest). */
async function readItem(item: Locator): Promise<{ label: string; description?: string; checked: boolean }> {
  const text = (await item.innerText().catch(() => '')).trim();
  const [label = '', ...rest] = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const checked =
    (await item.getAttribute('aria-checked').catch(() => null)) === 'true' ||
    (await item.getAttribute('aria-selected').catch(() => null)) === 'true';
  return { label, ...(rest.length ? { description: rest.join(' ') } : {}), checked };
}

/**
 * Read the models in an open menu. Items that open a submenu are hovered, as a person would, and the
 * submenu's models are added with the parent as their group. Recurses one level per submenu, max depth 3.
 */
async function readMenu(
  page: Page,
  menu: Locator,
  group?: string,
  parentPath: string[] = [],
  depth = 0,
): Promise<ModelInfo[]> {
  const items = menu.locator(S.MODEL_ITEMS.join(', '));
  const models: ModelInfo[] = [];
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const { label, description, checked } = await readItem(item);
    if (!label) continue;
    if (depth < 3) {
      const submenu = await openSubmenu(page, item);
      if (submenu) {
        // Copilot renames a submenu entry to the model chosen inside it ("GPT" becomes
        // "GPT-5.6 Sol Quick response"), but its second line ("OpenAI") stays. Key the group on that.
        const name = description ?? label;
        models.push(
          ...(await readMenu(
            page,
            submenu,
            group ? `${group} › ${name}` : name,
            [...parentPath, name],
            depth + 1,
          )),
        );
        continue;
      }
    }
    const path = [...parentPath, label];

    models.push({
      id: path.join('/'),
      label,
      ...(description ? { description } : {}),
      ...(group ? { group } : {}),
      path,
      ...(checked ? { selected: true } : {}),
    });
  }
  return models;
}

/** If `item` opens a submenu, hover it and return the submenu once visible; otherwise null. */
async function openSubmenu(page: Page, item: Locator): Promise<Locator | null> {
  const opensSubmenu = await item
    .evaluate((el, sel) => el.matches(sel), S.SUBMENU_TRIGGER)
    .catch(() => false);
  if (!opensSubmenu) return null;
  const before = await page.locator(S.SUBMENU).count();
  await item.hover().catch(() => {});
  const submenu = page.locator(S.SUBMENU).nth(before);
  const visible = await submenu
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  return visible ? submenu : null;
}

/** Click the picker button and return its menu, or null if no picker opens. */
async function openPicker(page: Page): Promise<{ menu: Locator; label: string; selector: string } | null> {
  for (const selector of S.MODEL_PICKER) {
    const button = page.locator(selector).first();
    if (!(await button.isVisible().catch(() => false))) continue;
    const label =
      (await button.getAttribute('aria-label').catch(() => null)) ??
      (await button.innerText().catch(() => ''));
    await button.click({ timeout: 3000 }).catch(() => {});
    const menu = page.locator(S.MODEL_MENU.join(', ')).last();
    const visible = await menu
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (visible) return { menu, label: label.trim().split('\n')[0] ?? '', selector };
    await closeMenus(page);
  }
  return null;
}

/** Press Escape until no menu is left open (each press closes one level). */
async function closeMenus(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const open = await page
      .locator(S.SUBMENU)
      .first()
      .isVisible()
      .catch(() => false);
    if (!open) return;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150).catch(() => {});
  }
}

/** Open the first visible model picker and read its options. */
export async function readPicker(page: Page, notes: string[]): Promise<ModelInfo[]> {
  const picker = await openPicker(page);
  if (!picker) return [];
  const models = await readMenu(page, picker.menu);
  await closeMenus(page);
  if (models.length > 0) notes.push(`Read from the picker "${picker.label}" (selector: ${picker.selector}).`);
  return models;
}

/** Click through the picker along `path` (top menu label, submenu label, ..., model label). */
export async function clickPath(page: Page, path: string[]): Promise<boolean> {
  const picker = await openPicker(page);
  if (!picker) return false;
  let menu = picker.menu;
  for (let step = 0; step < path.length; step++) {
    const items = menu.locator(S.MODEL_ITEMS.join(', '));
    let target: Locator | null = null;
    const last = step === path.length - 1;
    for (let i = 0; i < (await items.count()); i++) {
      const { label, description } = await readItem(items.nth(i));
      // Submenu entries are keyed by their stable second line (see readMenu); models by their label.
      if ((last ? label : (description ?? label)) === path[step]) {
        target = items.nth(i);
        break;
      }
    }
    if (!target) break;
    if (step === path.length - 1) {
      await target.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500).catch(() => {});
      await closeMenus(page);
      return true;
    }
    const submenu = await openSubmenu(page, target);
    if (!submenu) break;
    menu = submenu;
  }
  await closeMenus(page);
  return false;
}
