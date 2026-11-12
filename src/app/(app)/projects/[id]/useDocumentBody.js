'use client';
// The text of one file or note (CONTRACT 22). The list on the Phases tab comes without any text, so
// it is fetched when first needed: opening the name's box, or editing a note. The last few stay in
// memory for this tab, so opening a box again shows it at once; an edit makes a new version, which
// is fetched again.
import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';

const KEEP = 8;
const bodies = new Map(); // version -> text, oldest first

/** Which text a document has: its id and when it last changed. */
export function bodyVersion(document) {
  const changed = new Date(document.updatedAt ?? document.createdAt ?? 0).getTime();
  return `${document.id}:${changed}`;
}

function remember(version, body) {
  bodies.delete(version);
  bodies.set(version, body);
  while (bodies.size > KEEP) bodies.delete(bodies.keys().next().value);
}

function stateFor(version) {
  return bodies.has(version)
    ? { version, status: 'ready', body: bodies.get(version) }
    : { version, status: 'loading' };
}

/**
 * @param {{ id: number, updatedAt?: Date | string, createdAt?: Date | string }} document
 * @returns {{ status: 'loading' | 'ready' | 'error', body?: string, message?: string,
 *   retry: () => void }} body: the text (a file's pages separated by \f); message: the API's
 *   reason it failed
 */
export function useDocumentBody(document) {
  const { id } = document;
  const version = bodyVersion(document);
  const [state, setState] = useState(() => stateFor(version));
  let shown = state;
  if (state.version !== version) {
    shown = stateFor(version);
    setState(shown);
  }
  const { status } = shown;

  useEffect(() => {
    if (status !== 'loading') return undefined;
    const controller = new AbortController();
    api.get(`/api/project-documents/${id}`, { signal: controller.signal }).then(
      ({ data }) => {
        remember(version, data.body);
        setState({ version, status: 'ready', body: data.body });
      },
      (error) => {
        if (error?.name === 'AbortError') return;
        setState({ version, status: 'error', message: error.message });
      },
    );
    return () => controller.abort();
  }, [id, version, status]);

  return { ...shown, retry: () => setState({ version, status: 'loading' }) };
}
