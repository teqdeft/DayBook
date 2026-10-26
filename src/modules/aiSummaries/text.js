// Text rules for the summaries (CONTRACT 20): Gemini's answer becomes plain text with short "- "
// lists, cut to a length at a line; the bell gets its first 300 characters on one line; the
// summary page shows it as paragraphs, labels ("Done:") and lists. Pure functions.

/** Shown with every summary, on its pages and in the Slack DM (CONTRACT 20). */
export const AI_NOTE = "Written by AI from Daybook's data. Check anything important.";
/** The bell's body: the first characters of the summary (CONTRACT 20). */
export const BELL_BODY_MAX = 300;
const TITLE_MAX = 120;

/** Cuts a one-line text to `max` characters at a word, with "…". */
function cutLine(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** One line without Markdown: no bold or italics markers, headings or code ticks. */
function plainLine(line) {
  return line
    .replace(/\*\*|__|`/g, '')
    .replace(/^(\s*)#{1,6}\s+/, '$1')
    .replace(/^(\s*)(?:[*•·–—]|\d+[.)])\s+/, '$1- ')
    .trimEnd();
}

/**
 * A model's title as one short line: no Markdown or quotes around it, at most 120 characters.
 * @param {string} title
 * @returns {string} '' when nothing is left
 */
export function cleanTitle(title) {
  const unquoted = String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '');
  const line = plainLine(unquoted.trim()).replace(/^-\s+/, '').trim();
  return cutLine(line, TITLE_MAX);
}

/**
 * A model's body as plain text: Markdown markers removed, bullets written "- " (indented ones
 * "  - "), at most one empty line in a row, and at most `max` characters — cut after the last
 * whole line that fits, or inside a long last line at a word with "…".
 * @param {string} body
 * @param {number} max
 * @returns {string}
 */
export function cleanBody(body, max) {
  const lines = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => plainLine(line).replace(/^\s+-\s+/, '  - '));
  const text = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= max) return text;
  const lineEnd = text.slice(0, max).lastIndexOf('\n');
  if (lineEnd > max / 2) return text.slice(0, lineEnd).trimEnd();
  // The line that crosses the limit is long: keep the lines before it and cut it at a word.
  const head = text.slice(0, lineEnd + 1);
  const line = text.slice(head.length).split('\n')[0];
  return `${head}${cutLine(line, max - head.length)}`.trimEnd();
}

/**
 * The bell's body: the summary's first 300 characters on one line ("acme-store · Done: Fixed
 * the login bug · …"), cut at a word.
 * @param {string} body
 * @returns {string}
 */
export function bellBody(body) {
  const parts = String(body ?? '')
    .split('\n')
    .map((line) => line.trim().replace(/^-\s+/, ''))
    .filter(Boolean);
  let line = '';
  for (const part of parts) {
    if (!line) line = part;
    else line += line.endsWith(':') ? ` ${part}` : ` · ${part}`;
    if (line.length > BELL_BODY_MAX) break;
  }
  return cutLine(line, BELL_BODY_MAX);
}

/**
 * The page's blocks for a body: consecutive "- " lines become one list (indented ones are sub
 * items), a short line ending with ":" is a label ("Done:"), anything else a paragraph.
 * @param {string} body
 * @returns {Array<{ type: 'paragraph' | 'label', text: string } |
 *   { type: 'list', items: Array<{ text: string, sub: boolean }> }>}
 */
export function toBlocks(body) {
  const blocks = [];
  for (const raw of String(body ?? '').split('\n')) {
    const item = /^(\s*)-\s+(.*)$/.exec(raw);
    if (item) {
      const last = blocks.at(-1);
      const entry = { text: item[2].trim(), sub: item[1].length > 0 };
      if (last?.type === 'list') last.items.push(entry);
      else blocks.push({ type: 'list', items: [entry] });
      continue;
    }
    const text = raw.trim();
    if (!text) continue;
    const label = text.endsWith(':') && text.length <= 60;
    blocks.push({ type: label ? 'label' : 'paragraph', text });
  }
  return blocks;
}
