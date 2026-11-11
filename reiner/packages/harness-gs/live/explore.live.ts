/**
 * @file A look at a Google page as the harness's browser sees it: opens an address in the project's own
 * profile, optionally types a prompt, and writes what is on the page (inputs, buttons, links, a text
 * outline, the HTML and a screenshot) into `.reiner/logs/`. For finding selectors when the page changes.
 * Not part of `pnpm test`. It only looks: nothing is clicked except what the options name.
 *
 * From reiner/:
 *   PowerShell: $env:REINER_CWD = '../test-projects/test02'; pnpm live:gs-explore
 *   bash:       REINER_CWD=../test-projects/test02 pnpm live:gs-explore
 *
 * Options (environment): URL (address to open), ASK (text to type and send), INPUT (selector of the
 * box to type into), CLICK (text of a button or link to click first), WAIT (seconds to wait after
 * sending, default 20), HOLD (seconds to keep the window open for use by hand before recording), NAME
 * (name for the files written).
 *
 * @see {@link ../docs/module.md#live-checks | The Google Search module: live checks}
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openProfile } from '@co-reiner/browser';

const root = path.resolve(process.env.REINER_CWD || process.cwd());
const url = process.env.URL || 'https://www.google.com/';
// Not PROMPT: on Windows that variable is the command prompt's own (`$P$G`), set for every script.
const prompt = process.env.ASK;
const waitSeconds = Number(process.env.WAIT || 20);
const name = process.env.NAME || 'explore';
const logs = path.join(root, '.reiner', 'logs');

const opened = await openProfile({
  profileDir: path.join(root, '.reiner', 'profiles', 'google-search'),
  channel: 'auto',
  headless: false,
});
const { page } = opened;
const log = (text: string) => console.log(text);

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  log(`opened ${page.url()} in ${opened.channel}`);
  // Google's robot check is the user's to answer: wait while the window is on it, never touch it.
  if (page.url().includes('/sorry/')) {
    log('Google is asking to confirm you are not a robot. Answer it in the window; waiting up to 8 minutes…');
    await page.waitForURL((u) => !u.toString().includes('/sorry/'), { timeout: 8 * 60_000 });
    await page.waitForTimeout(3000);
    log(`passed, now at ${page.url()}`);
  }
  if (process.env.CLICK) {
    // `css=<selector>` clicks by selector; anything else is the visible text of a button or link.
    const what = process.env.CLICK;
    const target = what.startsWith('css=')
      ? page.locator(what.slice(4))
      : page.getByText(what, { exact: true });
    await target.first().click();
    await page.waitForTimeout(3000);
    log(`clicked "${process.env.CLICK}", now at ${page.url()}`);
  }
  if (prompt) {
    const box = page.locator(process.env.INPUT || 'textarea').first();
    await box.click();
    await page.keyboard.insertText(prompt);
    await page.keyboard.press('Enter');
    log(`sent the prompt; waiting ${waitSeconds} s`);
    await page.waitForTimeout(waitSeconds * 1000);
    log(`now at ${page.url()}`);
  }
  // HOLD: keep the window open for a while first, so a person can try something by hand in this very
  // profile and window; what is recorded is the page as they left it.
  const hold = Number(process.env.HOLD || 0);
  if (hold > 0) {
    log(`holding the window open for ${hold} s: use it by hand now`);
    await page.waitForTimeout(hold * 1000);
    log(`now at ${page.url()}`);
  }
  // No named inner functions in here: tsx would add a helper the page does not have.
  const seen = await page.evaluate(() => {
    const inputs: string[] = [];
    for (const el of document.querySelectorAll(
      'textarea, input, [contenteditable="true"], [role="textbox"]',
    )) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      inputs.push(
        `${el.tagName.toLowerCase()} name=${el.getAttribute('name')} type=${el.getAttribute('type')} role=${el.getAttribute('role')} aria-label=${el.getAttribute('aria-label')} placeholder=${el.getAttribute('placeholder')} id=${el.id} class=${String(el.className).slice(0, 60)}`,
      );
    }
    const buttons: string[] = [];
    for (const el of document.querySelectorAll('button, [role="button"], a')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const label = el.getAttribute('aria-label');
      if (!text && !label) continue;
      buttons.push(
        `${el.tagName.toLowerCase()} text="${text}" aria-label=${label} href=${(el.getAttribute('href') || '').slice(0, 90)} jsname=${el.getAttribute('jsname')}`,
      );
    }
    const dialogs: string[] = [];
    for (const el of document.querySelectorAll('[role="dialog"], [aria-modal="true"]')) {
      dialogs.push(((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300));
    }
    return {
      title: document.title,
      inputs,
      buttons: buttons.slice(0, 150),
      dialogs,
      text: (document.body.innerText || '').slice(0, 6000),
    };
  });
  await mkdir(logs, { recursive: true });
  await writeFile(path.join(logs, `${name}.json`), JSON.stringify({ url: page.url(), ...seen }, null, 2));
  await writeFile(path.join(logs, `${name}.html`), await page.content());
  await page.screenshot({ path: path.join(logs, `${name}.png`) });
  log(`title: ${seen.title}`);
  log(`inputs:\n  ${seen.inputs.join('\n  ')}`);
  log(`dialogs: ${seen.dialogs.length ? seen.dialogs.join(' | ') : 'none'}`);
  log(`written to ${path.join(logs, name)}.{json,html,png}`);
} finally {
  await opened.close({ wait: true });
}
