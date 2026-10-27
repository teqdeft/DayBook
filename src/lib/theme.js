// The person's theme in the browser (CONTRACT 21). Browser-safe: no server imports. `data-theme`
// on <html> overrides the computer's light or dark setting (globals.css); 'system' removes it. A
// copy in localStorage lets the launch script apply it before the first paint, so pages don't
// flash. Only 'light' and 'dark' are ever stored or applied.

export const THEME_STORAGE_KEY = 'daybook-theme';
export const THEMES = Object.freeze(['system', 'light', 'dark']);

const FORCED = new Set(['light', 'dark']);

function storage() {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null);
  } catch {
    return null; // storage blocked (privacy settings): the attribute still applies
  }
}

/**
 * Applies a theme to the page and remembers it for the next launch: 'light' or 'dark' set
 * `data-theme` and are stored; 'system' (or anything else) removes both.
 * @param {'system' | 'light' | 'dark' | string} theme
 */
export function applyTheme(theme) {
  const forced = FORCED.has(theme) ? theme : null;
  if (typeof document !== 'undefined' && document.documentElement) {
    if (forced) document.documentElement.dataset.theme = forced;
    else delete document.documentElement.dataset.theme;
  }
  const store = storage();
  if (!store) return;
  try {
    if (forced) store.setItem(THEME_STORAGE_KEY, forced);
    else store.removeItem(THEME_STORAGE_KEY);
  } catch {
    // full or blocked: the page still has the theme, only the next launch may flash
  }
}

/**
 * The theme kept for the next launch: 'light' or 'dark', or null (follow the computer, or nothing
 * usable stored).
 * @returns {'light' | 'dark' | null}
 */
export function storedTheme() {
  const store = storage();
  if (!store) return null;
  try {
    const value = store.getItem(THEME_STORAGE_KEY);
    return FORCED.has(value) ? value : null;
  } catch {
    return null;
  }
}
