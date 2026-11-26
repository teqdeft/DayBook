// Copies plain text to the clipboard (CONTRACT 28, Copy button on the Slack preview). Browser-safe,
// no imports, so every copy action of 1.13 can share it. The Clipboard API goes first; when it is
// missing (an older browser, a page that isn't a secure context) or refuses (no permission, the
// page lost focus), a hidden textarea is selected and `document.execCommand('copy')` copies it.
// It never throws: the caller shows "Copied" for true and its error for false.

/** Off screen and out of the way: never seen, never clicked, never read out. */
const HIDDEN_STYLE = {
  position: 'fixed',
  top: '0',
  left: '-9999px',
  width: '1px',
  height: '1px',
  opacity: '0',
  pointerEvents: 'none',
};

async function viaClipboard(text) {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (typeof clipboard?.writeText !== 'function') return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Gives focus back to what had it, since selecting the textarea took it (the button, mostly). */
function refocus(element, body) {
  if (!element || element === body || typeof element.focus !== 'function') return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    // the element went away meanwhile: focus stays where it is
  }
}

function viaTextarea(text) {
  const doc = globalThis.document;
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;
  const focused = doc.activeElement;
  let area = null;
  try {
    area = doc.createElement('textarea');
    area.value = text;
    // read-only keeps a phone's keyboard closed while it is selected
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.setAttribute('tabindex', '-1');
    Object.assign(area.style, HIDDEN_STYLE);
    doc.body.appendChild(area);
    area.select();
    area.setSelectionRange?.(0, text.length);
    return doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    area?.remove();
    if (area) refocus(focused, doc.body);
  }
}

/**
 * Puts `text` on the clipboard as it is (line breaks and bullets kept).
 * @param {string} text
 * @returns {Promise<boolean>} true once copied, false when neither way worked; never rejects
 */
export async function copyText(text) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (await viaClipboard(value)) return true;
  return viaTextarea(value);
}
