// Scripts that run before the page paints. The launch check for LaunchSplash (src/app/layout.js),
// which also applies the theme kept in localStorage, and the signed-in layout's theme script
// (ThemeSync, CONTRACT 21). A plain module (not 'use client') so the root layout gets the string
// itself.
import { THEME_STORAGE_KEY } from '@/lib/theme';

/** sessionStorage key: set the first time Daybook opens in a window, so reloads don't replay. */
export const LAUNCH_KEY = 'daybook:launched';

// The only themes ever written into a script or onto <html>: 'system' follows the computer.
const FORCED_THEMES = Object.freeze(['light', 'dark']);

/**
 * The splash plays only when Daybook is launched: the first page of a window or tab. Reloads,
 * people who prefer reduced motion, and automated browsers (tests, screenshots) get
 * data-launch="skip" on <html>, which hides it before the first paint.
 * First it puts the theme kept in localStorage on <html> (only 'light' or 'dark'; anything else
 * follows the computer), so pages don't flash. Blocked storage just follows the computer.
 */
export const LAUNCH_SCRIPT = `(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  } catch (error) {}
  try {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (navigator.webdriver || reduce || sessionStorage.getItem('${LAUNCH_KEY}')) {
      root.setAttribute('data-launch', 'skip');
    } else {
      sessionStorage.setItem('${LAUNCH_KEY}', '1');
    }
  } catch (error) {
    root.setAttribute('data-launch', 'skip');
  }
})();`;

/**
 * The signed-in person's saved theme, set before the first paint (it runs in <head>, before the
 * launch script): data-theme on <html> and the localStorage copy, so the launch script that runs
 * next and later launches agree with it. Only a literal from FORCED_THEMES is ever written into
 * the script, never the value passed in; anything else ('system') removes both. When the copy
 * can't be saved (storage full), the old one is removed so it can't override this one.
 * @param {string} theme the person's `theme` preference
 * @returns {string} JavaScript source
 */
export function themeScript(theme) {
  const forced = FORCED_THEMES.find((name) => name === theme);
  const value = forced ? `'${forced}'` : 'null';
  return `(function () {
  var theme = ${value};
  var root = document.documentElement;
  if (theme) root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  try {
    if (theme) localStorage.setItem('${THEME_STORAGE_KEY}', theme);
    else localStorage.removeItem('${THEME_STORAGE_KEY}');
  } catch (error) {
    try {
      localStorage.removeItem('${THEME_STORAGE_KEY}');
    } catch (ignored) {}
  }
})();`;
}
