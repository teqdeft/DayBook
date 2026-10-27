'use client';
// Keeps the page in the signed-in person's theme (CONTRACT 21). Mounted once by AppFrame with the
// saved `theme`. While the page is rendered on the server it adds the theme script (launchScript.js)
// to the page's <head>, so data-theme is set before the first paint, even on a new computer. In
// the browser it applies the theme again with applyTheme, which also keeps the localStorage copy
// in step, and again whenever the saved value changes (a router.refresh after My settings saves).
//
// useServerInsertedHTML rather than a <script> element: React never runs a <script> it creates in
// the browser (a client-side move into the signed-in app, as after the dev sign-in) and warns.
import { useEffect, useRef } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { applyTheme } from '@/lib/theme';
import { themeScript } from './launchScript';

/**
 * @param {{ theme: 'system' | 'light' | 'dark' }} props the person's saved theme
 */
export default function ThemeSync({ theme }) {
  // The server calls the callback for every flush of the page; the script goes in the first.
  const inserted = useRef(false);
  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return <script dangerouslySetInnerHTML={{ __html: themeScript(theme) }} />;
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return null;
}
