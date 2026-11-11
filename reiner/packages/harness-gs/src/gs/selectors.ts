/**
 * @file Every address and selector of Google Search's AI mode page in one place, so a change to the page
 * is a one-file fix.
 * @see {@link ../../docs/module.md#the-page | The Google Search module: the page}
 */

/** AI mode of Google Search. Opens without a Google account. */
export const AI_MODE_URL = 'https://www.google.com/search?udm=50';

/** Hosts the AI mode page lives on (google.com and the country domains). */
export const APP_HOSTS = /(^|\.)google\.[a-z.]+$/i;

/** Google's own sign-in pages: the user may sign in by hand, the module never types there. */
export const LOGIN_HOSTS = /^accounts\.google\.[a-z.]+$/i;

/**
 * Google's "unusual traffic" page, where it asks the person to confirm they are not a robot. The module
 * never answers it: it hands the window to the user.
 */
export const ROBOT_CHECK_PATH = '/sorry/';

/**
 * An ordinary search, used only to see whether a robot check is pending. AI mode itself never shows the
 * check: while one is pending it silently leaves replies empty, and the ordinary results page shows it.
 */
export const PROBE_URL = 'https://www.google.com/search?q=weather';

/** The prompt box. */
export const CHAT_INPUT = 'textarea[aria-label="Ask anything"]';

/** Starts a new conversation ("thread"). */
export const NEW_THREAD = 'button[aria-label="New thread"]';

/** Opens the menu with the upload entries. */
export const ADD_MENU = 'button[aria-label="Add files and tools"]';

/** The menu entry that opens the file chooser for any kind of file. */
export const ADD_FILES = 'button[aria-label="Add files"]';

/** Shown instead of the microphone while a reply is being written. */
export const STOP_BUTTON = 'button[aria-label="Stop"]';

/**
 * One turn of the conversation: the prompt and, once it arrives, the reply. All turns sit inside one
 * `aim-mars-turn-root` container, each in a block of its own.
 */
export const TURN = '[data-xid="aim-mars-turn-root"] > [jsname="RH7zg"]';

/** The prompt's text inside a turn. */
export const TURN_PROMPT = 'span[role="heading"][aria-level="2"]';

/** The reply inside a turn. It carries `data-complete="true"` once the reply is finished. */
export const REPLY = '[data-scope-id="turn"]';

/** The attribute and value that mark a finished reply. */
export const REPLY_COMPLETE = 'data-complete';

/** The reply's own text inside `REPLY`, without its heading and the buttons under it. */
export const REPLY_BODY = '[data-container-id="main-col"]';

/** Shown under a finished reply. */
export const COPY_REPLY = 'button[aria-label="Copy text"]';

// Inside a reply's HTML (read in Node by markdown.ts).

/** Headings in a reply are divs with a heading role; the level is in `aria-level`. */
export const REPLY_HEADING = '[role="heading"][aria-level]';

/**
 * A code block in a reply: a widget with the language's name in its first small div, the code in a
 * `<pre>`, and a caution line and copy button under it.
 */
export const CODE_BLOCK = '[class*="CodeBlock"]';

/**
 * Page furniture inside a reply, not part of the answer: source chips, the row of buttons under the reply
 * (`Gd7Hsc`) with its feedback forms, and the follow-up suggestions (`aimba`).
 */
export const REPLY_NOISE =
  'svg, img, button, style, script, [aria-live], .notranslate, [role="button"], [role="region"], [data-xid="Gd7Hsc"], [data-subtree="aimba"]';
