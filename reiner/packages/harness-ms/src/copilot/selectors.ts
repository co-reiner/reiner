/**
 * @file Every URL pattern and DOM selector the Microsoft 365 Copilot module depends on.
 * When Copilot's web UI changes, this should be the only file that needs editing.
 *
 * They describe the page as it was last seen signed in. When something stops matching, run
 * `reiner models --debug` and check the dump in `.reiner/logs/` to correct them.
 *
 * @see {@link ../../docs/module.md#code-layout | Copilot module: code layout}
 * @see {@link ../../docs/module.md#chat-history | Copilot module: chat history}
 * @see {@link ../../docs/file-exchange.md#co-editing-documents | Copilot file exchange: co-editing documents}
 */

export const COPILOT_URL = 'https://m365.cloud.microsoft/chat';

/** Hosts where the signed-in Copilot app lives (it may redirect between them). */
export const APP_HOSTS =
  /(^|\.)(m365\.cloud\.microsoft|microsoft365\.com|office\.com|copilot\.cloud\.microsoft)$/i;

/** Hosts of Microsoft sign-in pages. Signed-in users may pass through these briefly on redirect. */
export const LOGIN_HOSTS =
  /(^|\.)(login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com|account\.live\.com)$/i;

/** The chat prompt box. Its presence means we are signed in and the app has loaded. */
export const CHAT_INPUT = [
  '[role="textbox"][contenteditable="true"]',
  'textarea[placeholder]',
  '#m365-chat-editor-target-element',
  '[data-lexical-editor="true"]',
];

/*
 * Chat. The prompt box is a contenteditable span; Enter sends. Each reply's text is
 * in a [data-testid=markdown-reply] inside the "Chat conversation" feed. While a reply is being written a
 * "Stop generating" button shows; it goes away when the reply is complete. Code blocks are "Code Preview"
 * groups with the language in [data-testid=one-copilot-code-identity] and one [data-line-index] per line.
 * Copilot renders long code blocks lazily, so very long code may not all be in the page at once.
 * Thinking models ("Think deeper") first add an empty [data-testid=markdown-reply] while they think, then
 * write the answer in a second one in the same turn. Read the newest one.
 */

/** Each assistant reply's rendered markdown. */
export const REPLY = '[data-testid="markdown-reply"]';

/** Each prompt the user sent, in the conversation. A turn's replies come after its prompt. */
export const QUESTION = '[data-testid="chatQuestion"]';

/** Shown only while a reply is being written. */
export const STOP_BUTTON = 'button[aria-label*="Stop generating" i], button[aria-label^="Stop" i]';

/*
 * Chat history. The sidebar lists recent chats as links to /chat/conversation/<id>,
 * or /chat/agent/<agent>.<conversation> for chats with one of Copilot's agents; each link's aria-label is the chat title, and the open chat has aria-current. Next to each link a
 * "More" button opens a menu: Pin, Rename, Move to notebook, Delete. Rename turns the title into an
 * input labelled "Chat name" (select all, type, Enter). Delete asks for confirmation with "Cancel" and
 * "Delete" buttons. Older chats are not in the list; they are found with "Search chats" or opened by URL.
 */

/** A chat in the history sidebar. */
export const CHAT_LINK = 'a[href*="/chat/conversation/"], a[href*="/chat/agent/"]';
/** The per-chat options button, a sibling of the link. */
export const CHAT_MORE = 'button[aria-label="More"]';
export const CHAT_MENU_ITEM = '[role="menu"] [role^="menuitem"]';
export const CHAT_RENAME_INPUT = 'input[aria-label="Chat name"]';
/** Shows the sidebar when it has been collapsed. */
export const SIDEBAR_TOGGLE = 'button[data-testid="nav-toggle-button"]';
/**
 * A chat's id in Reiner, built from its URL:
 * - plain chat, /chat/conversation/<id>: the conversation id;
 * - agent chat, /chat/agent/<agent>/conversation/<id>: "agent/<agent>/conversation/<id>".
 * An agent chat's sidebar link only points at the agent (/chat/agent/<agent>); its conversation id is the
 * link's own id attribute, so pass that as `linkId`.
 */
const AGENT_CHAT = /\/chat\/agent\/([^/?#]+)(?:\/conversation\/([0-9a-z-]+))?/i;
const PLAIN_CHAT = /\/chat\/conversation\/([0-9a-z-]+)/i;

export function chatIdOf(urlOrHref: string, linkId?: string | null): string | undefined {
  const agent = AGENT_CHAT.exec(urlOrHref);
  if (agent) {
    const conversation = agent[2] ?? linkId ?? undefined;
    return conversation ? `agent/${agent[1]}/conversation/${conversation}` : `agent/${agent[1]}`;
  }
  return PLAIN_CHAT.exec(urlOrHref)?.[1];
}

/** The path that opens a chat, for chats that are no longer in the sidebar. */
export function chatPathOf(id: string): string {
  return id.startsWith('agent/') ? `/chat/${id}` : `/chat/conversation/${id}`;
}

/** A CSS selector for exactly this chat's sidebar link. */
export function chatLinkSelector(id: string): string {
  const conversation = /\/conversation\/([0-9a-z-]+)$/i.exec(id)?.[1];
  return id.startsWith('agent/') && conversation
    ? `a[href*="/chat/agent/"][id="${conversation}"]`
    : `a[href*="/chat/conversation/${id}"]`;
}

/** Starts a fresh conversation. */
export const NEW_CHAT = 'a[aria-label="New chat"], button[aria-label="New chat"]';

/** Code blocks inside a reply. */
export const CODE_BLOCK = '[role="group"][aria-label="Code Preview"]';
export const CODE_LANGUAGE = '[data-testid="one-copilot-code-identity"] span';
export const CODE_LINE = '[data-line-index]';

/** Fields that mean the sign-in page wants the user to act. */
export const LOGIN_PROMPTS = [
  'input[type="email"]',
  'input[type="password"]',
  'input[name="loginfmt"]',
  '#tilesHolder', // "Pick an account"
  '[data-test-id="otherTile"]',
];

/*
 * Model picker: a button labelled "<current>, Model Selector" opens a Fluent UI
 * [role=menu] of [role=menuitemradio] items (aria-checked marks the current one). A [role=menuitem] with
 * aria-haspopup="menu" (e.g. "GPT · OpenAI") opens a second [role=menu] on hover, rendered as a sibling
 * of the first, not inside it.
 *
 * Choosing a model inside a submenu renames that submenu entry to the model's name ("GPT" becomes
 * "GPT-5.6 Sol Quick response") and the picker button to "GPT-5.6 Sol Quick, Model Selector". The entry's
 * second line ("OpenAI") does not change. Every page load resets the choice to "Auto".
 */

/** Buttons that may open the model or response-mode picker. Tried in order; first visible one wins. */
export const MODEL_PICKER = [
  'button[aria-label*="Model Selector" i]',
  'button[aria-label*="model" i]',
  '[data-testid*="model" i] button',
  'button[data-testid*="model" i]',
  'button[aria-haspopup]:has-text("GPT")',
  'button[aria-haspopup]:has-text("Auto")',
  'button[aria-haspopup]:has-text("Quick response")',
  'button[aria-haspopup]:has-text("Think deeper")',
  'button:has-text("GPT-")',
];

/** Popup containers that hold the model options once the picker is open. */
export const MODEL_MENU = ['[role="menu"]', '[role="listbox"]', '[role="dialog"]'];

/** Items inside the popup. */
export const MODEL_ITEMS = [
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="radio"]',
];

/** An item that opens a nested menu of more models. */
export const SUBMENU_TRIGGER = '[aria-haspopup="menu"], [aria-haspopup="true"]';

/** Nested menus opened from a submenu trigger. */
export const SUBMENU = '[role="menu"]';

/** The "+" button by the prompt box; its menu has "Upload images and files". */
export const PLUS_MENU = '[data-testid="PlusMenuButton"]';
export const UPLOAD_MENU_ITEM = 'Upload images and files';
/** An attachment chip in the prompt box. Its aria-label is the file name; an `SPO_…` id means stored. */
export const ATTACHMENT = '.fx-Attachment';
export const SEND_BUTTON = 'button[aria-label="Send"]';

/** The button on an attachment chip in the prompt box's draft that takes the attachment out again. */
export const REMOVE_ATTACHMENT = 'button[aria-label^="Remove attachment"]';

/** A download link in a reply, for a file the model created (`<a download="name" href="blob:…">`). */
export const DOWNLOAD_LINK = 'a[download]';
/** The download link whose `download` attribute is exactly this file name. */
export const downloadLinkNamed = (name: string) =>
  `${DOWNLOAD_LINK}[download="${name.replace(/["\\]/g, '\\$&')}"]`;

/**
 * A file card in a reply, for a file the model created and saved to OneDrive ("Saved in … OneDrive"). Its
 * name is the `title` of the card's primary text; it is downloaded through the card's own "More actions"
 * menu, item "Download".
 */
export const FILE_CARD = '.fai-EntityCard';
const FILE_CARD_TITLE = '.fai-EntityTitle__primaryText';
export const FILE_CARD_NAME = `${FILE_CARD_TITLE} [title]`;
/** The card whose name is exactly this file name. */
export const fileCardNamed = (name: string) =>
  `${FILE_CARD}:has(${FILE_CARD_TITLE} [title="${name.replace(/["\\]/g, '\\$&')}"])`;
export const FILE_CARD_MORE = 'button[aria-label="More actions"]';
export const MENU_ITEM = '[role="menuitem"]';
export const FILE_CARD_DOWNLOAD = 'Download';

/** OneDrive: the document library behind "My files", and where Copilot saves files it creates. */
export const DRIVE_LIBRARY = 'Documents';
export const DRIVE_CREATED_FOLDER = 'Documents/Copilot/Created';
/** Where Copilot stores files uploaded with the "+" menu, relative to the library (to confirm live). */
export const DRIVE_UPLOADS_FOLDER = 'Microsoft Copilot Chat Files';
/** A OneDrive row's context menu item that moves the file to the recycle bin, and its confirm button. */
export const DRIVE_DELETE_ITEM = 'Delete';
export const DRIVE_DELETE_CONFIRM = 'Delete';
/** The name cell of a row in a OneDrive folder list. */
export const DRIVE_ITEM_NAME =
  '[data-automationid="FieldRenderer-name"], [data-automationid="field-LinkFilename"], button[data-id="heroField"]';

/** Sent when the OneDrive folder for created files does not exist yet; Copilot makes it on first save. */
export const PROVISION_PROMPT =
  '[Reiner] Setup check: create a Word document named reiner-setup.docx with the single line "Reiner OneDrive check", and save it as a file for me. Reply with just: Done.';

/** Custom instructions: Settings and more → Settings → Personalization → Manage Customize Copilot. */
export const SETTINGS_MENU = '[aria-label="Settings and more"]';
export const SETTINGS_ITEM = 'Settings';
export const PERSONALIZATION_TAB = 'Personalization';
export const CUSTOMIZE_MANAGE = '[aria-label="Manage Customize Copilot"]';
export const INSTRUCTIONS_FIELD = '[role="dialog"] textarea';
export const SAVE_CUSTOMIZATION = 'Save customization';
export const SETTINGS_CLOSE = '[aria-label="Settings, Close"]';

/**
 * A document Copilot opened for co-editing: Word for the web embedded in the chat page. While it is open,
 * Copilot keeps the document in the prompt context, so Reiner closes it after each reply.
 */
export const COEDIT_FRAME =
  'iframe[src*="officeapps"], iframe[src*="Doc.aspx"], iframe[src*="WopiFrame"], iframe[src*="word-edit"]';
/** Close buttons that may belong to the pane around that frame, checked from the frame outwards. */
export const COEDIT_CLOSE =
  'button[aria-label*="Close" i], button[aria-label*="Dismiss" i], button[title*="Close" i]';
