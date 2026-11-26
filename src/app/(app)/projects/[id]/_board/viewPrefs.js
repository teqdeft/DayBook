// What the board remembers per person on that computer (CONTRACT 28, Board toolbar item 2; Done
// phases rail): the view (Board or Table) and whether the rail is open, in cookies the server reads
// (BoardTab), so the first paint is already right (never browser storage), and the `?view=` mirror
// of the address. Pure and safe on the server and in the browser.

/** The cookies that remember the board's view and rail. */
export const VIEW_COOKIE = 'daybook.board.view';
export const RAIL_COOKIE = 'daybook.board.rail';

const YEAR = 60 * 60 * 24 * 365;

/**
 * The view the page opens with: `?view=table` or `?view=board`, else the cookie, else the Board.
 * @param {string | string[] | undefined} wanted `?view=`
 * @param {string | undefined} remembered the view cookie's value
 * @returns {'board' | 'table'}
 */
export function firstView(wanted, remembered) {
  const asked = Array.isArray(wanted) ? wanted[0] : wanted;
  if (asked === 'table' || asked === 'board') return asked;
  return remembered === 'table' ? 'table' : 'board';
}

/** The text of a cookie remembered for a year on this computer (path /, SameSite=Lax). */
export const cookieText = (name, value) =>
  `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`;

/** Remembers a value for a year; nothing when the browser refuses cookies. */
export function rememberCookie(name, value) {
  try {
    document.cookie = cookieText(name, value);
  } catch {
    // a browser that refuses cookies just doesn't remember
  }
}

/** The page's address with `?view=table` (or without `view` for the Board), the rest kept. */
export function viewUrl(href, view) {
  const url = new URL(href);
  if (view === 'table') url.searchParams.set('view', 'table');
  else url.searchParams.delete('view');
  return `${url.pathname}${url.search}${url.hash}`;
}
