// The launch check for LaunchSplash, run in <head> before the page paints (src/app/layout.js).
// A plain module (not 'use client') so the root layout gets the string itself.

/** sessionStorage key: set the first time Daybook opens in a window, so reloads don't replay. */
export const LAUNCH_KEY = 'daybook:launched';

/**
 * The splash plays only when Daybook is launched: the first page of a window or tab. Reloads,
 * people who prefer reduced motion, and automated browsers (tests, screenshots) get
 * data-launch="skip" on <html>, which hides it before the first paint.
 */
export const LAUNCH_SCRIPT = `(function () {
  var root = document.documentElement;
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
