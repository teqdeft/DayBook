// The text of a Word document.xml in document order (CONTRACT 22), read by a small tokenizer rather
// than DOMParser: each paragraph a line, w:tab a tab, w:br and w:cr a line break, table cells joined
// by a tab and each row a line. Only w:t holds text, so field codes (w:instrText) and deleted words
// (w:delText) are never read; deleted and moved-away runs, paragraph properties and the fallback copy
// of a drawing are skipped whole, with any tab or break in them. XML's five entities and numeric
// references are decoded and nothing else is ever expanded: a DOCTYPE is skipped unread. Headers,
// footers, comments and footnotes live in other parts of the file, so they never reach this. A hostile
// file can't make it slow: tables nested past MAX_TABLE_DEPTH are read as words of the deepest cell,
// and reading stops once there is more text than Daybook keeps.
import { MAX_TEXT_LENGTH } from '@/modules/projectSummaries/schemas';

const WORD_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const COMPATIBILITY_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** What each WordprocessingML element means here; every other element is only looked through. */
const ROLES = Object.freeze({
  t: 'text',
  tab: 'tab',
  ptab: 'tab',
  br: 'break',
  cr: 'break',
  noBreakHyphen: 'hyphen',
  p: 'paragraph',
  tr: 'row',
  tc: 'cell',
  del: 'skip',
  moveFrom: 'skip',
  pPr: 'skip', // its w:tabs are tab stops, not tabs
});

const ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });
const REFERENCE = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*);/g;
const SPACE_CONTROLS = /\r\n?|[\t\n\v\f]/g;
const OTHER_CONTROLS = /[\u0000-\u0008\u000E-\u001F\u007F]/g;
const NAME = /[^\s/>]+/y;
const NAMESPACE_ATTRIBUTE = /xmlns(?::([^\s=]+))?\s*=\s*(["'])(.*?)\2/g;
const SPACES = /\s+/g;

/**
 * How many tables inside tables get rows and cells of their own. Closing a level re-reads the text
 * of every level inside it, so without a cap a 4 KB file nested a few thousand deep holds the tab
 * for minutes.
 */
export const MAX_TABLE_DEPTH = 8;
const MAX_FRAMES = 1 + 2 * MAX_TABLE_DEPTH; // the body, then a row and a cell for each level

/** A character XML allows; anything else a reference names is dropped. */
function isXmlChar(code) {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/** &amp; and the other four, and &#8377; or &#x20B9;. An unknown name stays as it was written. */
export function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(REFERENCE, (match, reference) => {
    if (reference[0] !== '#') return ENTITIES[reference] ?? match;
    const hex = reference[1] === 'x' || reference[1] === 'X';
    const code = Number.parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10);
    return isXmlChar(code) ? String.fromCodePoint(code) : '';
  });
}

/** Text as a run holds it: line breaks and tabs inside w:t are spaces, other controls go. */
function cleanRun(text) {
  return text.replace(SPACE_CONTROLS, ' ').replace(OTHER_CONTROLS, '');
}

/** Element names to roles, with the prefixes the root element declares (usually w: and mc:). */
function rolesFor(rootAttributes) {
  let word = 'w';
  let compatibility = 'mc';
  for (const [, prefix = '', , uri] of rootAttributes.matchAll(NAMESPACE_ATTRIBUTE)) {
    if (WORD_NAMESPACES.has(uri)) word = prefix;
    else if (uri === COMPATIBILITY_NAMESPACE) compatibility = prefix;
  }
  const qualified = (prefix, local) => (prefix ? `${prefix}:${local}` : local);
  const roles = new Map(
    Object.entries(ROLES).map(([local, role]) => [qualified(word, local), role]),
  );
  roles.set(qualified(compatibility, 'Fallback'), 'skip');
  return roles;
}

/**
 * Collects the text. Inside a table, breaks and tabs are spaces, so that each row stays one line
 * with its cells joined by tabs; a table inside a cell becomes words in that cell. Past
 * MAX_TABLE_DEPTH a row or cell opens no level: its words go straight into the deepest cell.
 * `full()` turns true once more than `maxLength` characters other than spaces are in. The writer
 * only ever drops or merges spaces, so the text then runs past `maxLength` whatever follows.
 */
function createWriter(maxLength) {
  const stack = [{ kind: 'body', parts: [] }];
  let flattened = 0; // rows and cells open past the cap
  let solid = 0; // characters written other than spaces
  const top = () => stack[stack.length - 1];
  const inTable = () => stack.length > 1;
  const write = (text) => {
    const { parts } = top();
    if (!parts) return;
    parts.push(text);
    solid += text.replace(SPACES, '').length;
  };
  const open = (frame) => {
    if (stack.length < MAX_FRAMES) stack.push(frame);
    else flattened += 1;
  };
  /** Closes a row or cell past the cap, as a space between its words; false when there is none. */
  const closeFlattened = () => {
    if (flattened === 0) return false;
    flattened -= 1;
    write(' ');
    return true;
  };
  const closeCell = () => {
    if (top().kind !== 'cell') return;
    const text = stack.pop().parts.join('').replace(SPACES, ' ').trim();
    if (top().kind === 'row') top().cells.push(text);
    else write(inTable() ? `${text} ` : `${text}\n`);
  };
  const closeRow = () => {
    while (top().kind === 'cell') closeCell();
    if (top().kind !== 'row') return;
    const { cells } = stack.pop();
    if (cells.every((cell) => cell === '')) return;
    write(inTable() ? `${cells.join(' ')} ` : `${cells.join('\t')}\n`);
  };
  return {
    write,
    closeCell: () => closeFlattened() || closeCell(),
    closeRow: () => closeFlattened() || closeRow(),
    tab: () => write(inTable() ? ' ' : '\t'),
    lineBreak: () => write(inTable() ? ' ' : '\n'),
    openRow: () => open({ kind: 'row', cells: [] }),
    openCell: () => open({ kind: 'cell', parts: [] }),
    emptyCell: () => top().cells?.push(''),
    full: () => solid > maxLength,
    finish() {
      while (stack.length > 1) (top().kind === 'cell' ? closeCell : closeRow)();
      return stack[0].parts.join('');
    },
  };
}

/** Where a start tag ends: the next ">" that isn't inside a quoted attribute value. */
function tagEnd(xml, from) {
  let quote = 0;
  for (let index = from; index < xml.length; index += 1) {
    const code = xml.charCodeAt(index);
    if (quote) {
      if (code === quote) quote = 0;
    } else if (code === 34 || code === 39) {
      quote = code;
    } else if (code === 62) {
      return index;
    }
  }
  return -1;
}

/** Where a <!DOCTYPE …> or other declaration ends, past an internal subset in [ ]. Never read. */
function declarationEnd(xml, open) {
  const close = xml.indexOf('>', open);
  if (close === -1 || !xml.slice(open, close).includes('[')) return close;
  const subsetEnd = xml.indexOf(']', open);
  return subsetEnd === -1 ? -1 : xml.indexOf('>', subsetEnd);
}

/** What a start or end tag does to the text, given the reader's state. */
function createHandlers(writer) {
  const state = { roles: null, skip: null, textDepth: 0 };
  const start = (name, selfClosing) => {
    if (state.skip) {
      if (!selfClosing && name === state.skip.name) state.skip.depth += 1;
      return;
    }
    const role = state.roles.get(name);
    if (role === 'skip' && !selfClosing) state.skip = { name, depth: 1 };
    else if (role === 'text' && !selfClosing) state.textDepth += 1;
    else if (role === 'tab') writer.tab();
    else if (role === 'break' || (role === 'paragraph' && selfClosing)) writer.lineBreak();
    else if (role === 'hyphen') writer.write('-');
    else if (role === 'row' && !selfClosing) writer.openRow();
    else if (role === 'cell') (selfClosing ? writer.emptyCell : writer.openCell)();
  };
  const end = (name) => {
    if (!state.roles) return;
    if (state.skip) {
      if (name === state.skip.name && (state.skip.depth -= 1) === 0) state.skip = null;
      return;
    }
    const role = state.roles.get(name);
    if (role === 'text') state.textDepth = Math.max(0, state.textDepth - 1);
    else if (role === 'paragraph') writer.lineBreak();
    else if (role === 'row') writer.closeRow();
    else if (role === 'cell') writer.closeCell();
  };
  const text = (raw, decode = true) => {
    if (state.textDepth > 0 && !state.skip)
      writer.write(cleanRun(decode ? decodeEntities(raw) : raw));
  };
  return { state, start, end, text };
}

/** One <…> at `open`; returns where reading goes on, -1 when the file ends inside it. */
function readMarkup(xml, open, handlers) {
  if (xml.startsWith('<!--', open)) {
    const close = xml.indexOf('-->', open + 4);
    return close === -1 ? -1 : close + 3;
  }
  if (xml.startsWith('<![CDATA[', open)) {
    const close = xml.indexOf(']]>', open + 9);
    if (close !== -1) handlers.text(xml.slice(open + 9, close), false);
    return close === -1 ? -1 : close + 3;
  }
  if (xml.startsWith('<!', open)) {
    const close = declarationEnd(xml, open);
    return close === -1 ? -1 : close + 1;
  }
  if (xml.startsWith('<?', open)) {
    const close = xml.indexOf('?>', open + 2);
    return close === -1 ? -1 : close + 2;
  }
  const closing = xml[open + 1] === '/';
  NAME.lastIndex = open + (closing ? 2 : 1);
  const name = NAME.exec(xml)?.[0];
  const close = name ? tagEnd(xml, NAME.lastIndex) : -1;
  if (close === -1) return -1;
  if (closing) {
    handlers.end(name);
  } else {
    if (!handlers.state.roles) {
      if (name.slice(name.indexOf(':') + 1) !== 'document') return -1;
      handlers.state.roles = rolesFor(xml.slice(NAME.lastIndex, close));
    }
    handlers.start(name, xml[close - 1] === '/');
  }
  return close + 1;
}

/**
 * The text of a document.xml, in document order.
 * @param {string} xml
 * @param {{ maxLength?: number }} [options] reading stops once the text holds more than `maxLength`
 *   characters other than spaces (by default MAX_TEXT_LENGTH, the most Daybook keeps), so the first
 *   `maxLength` characters of the trimmed text are always those of the whole document
 * @returns {string | null} the text (not trimmed, possibly empty); null when this isn't a Word
 *   document at all (its first element isn't w:document)
 */
export function docxText(xml, { maxLength = MAX_TEXT_LENGTH } = {}) {
  const writer = createWriter(maxLength);
  const handlers = createHandlers(writer);
  let at = 0;
  while (at !== -1 && at < xml.length && !writer.full()) {
    const open = xml.indexOf('<', at);
    if (open === -1) break;
    if (open > at && handlers.state.textDepth > 0) handlers.text(xml.slice(at, open));
    at = readMarkup(xml, open, handlers);
  }
  return handlers.state.roles ? writer.finish() : null;
}
