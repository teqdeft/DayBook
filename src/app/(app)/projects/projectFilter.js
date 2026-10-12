// The project search on My projects: by project name or client name (each card shows both). Pure
// (no server imports): the cards are filtered in the browser as the person types, and the server
// uses the same rule for a /projects?q= link.
import { compactName } from '@/lib/text';

/** Longest search text kept (the same cap as the PM view's ?q=). */
export const MAX_QUERY = 120;

/**
 * The search text to use: trimmed and cut to MAX_QUERY; '' for anything that isn't a string.
 * @param {unknown} value
 * @returns {string}
 */
export function cleanQuery(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_QUERY) : '';
}

/**
 * Whether a project name matches the search: any part of it, ignoring case, and 'acme app' or
 * 'acmeapp' also finds 'acme-app' (compactName drops spaces and dashes).
 * @param {string} name
 * @param {string} query
 * @returns {boolean}
 */
export function nameMatches(name, query) {
  const text = cleanQuery(query).toLowerCase();
  if (!text) return true;
  const value = String(name ?? '').toLowerCase();
  if (value.includes(text)) return true;
  const compact = compactName(text);
  return compact !== '' && compactName(value).includes(compact);
}

/**
 * The projects whose name or client name matches, in the order given; every item for an empty
 * search.
 * @template {{ name: string, clientName?: string | null }} T
 * @param {T[]} items
 * @param {string} query
 * @returns {T[]}
 */
export function filterProjects(items, query) {
  const list = items ?? [];
  if (!cleanQuery(query)) return list;
  return list.filter(
    (item) =>
      nameMatches(item.name, query) ||
      (item.clientName ? nameMatches(item.clientName, query) : false),
  );
}
