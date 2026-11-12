'use client';
// The small box under a file or note's name on the Phases tab (CONTRACT 22), as the prototype draws
// it. The text is fetched when the box opens and shown as plain text, never as HTML; a file's pages
// are split by a line with the page number. A long text scrolls inside the box.
import { Fragment } from 'react';
import { useDocumentBody } from './useDocumentBody';
import { textPages } from './documentsView';
import styles from './PhaseDocuments.module.css';

/**
 * The pages of a text. A text of one page has no page line.
 * @param {{ body: string, kind: 'file' | 'note' }} props
 */
export function TextPages({ body, kind }) {
  const pages = textPages(body, kind);
  return pages.map(({ number, text }) => (
    <Fragment key={number}>
      {pages.length > 1 && number > 1 ? (
        <p className={styles.pageBreak} role="separator" aria-label={`Page ${number}`}>
          <span aria-hidden="true">Page {number}</span>
        </p>
      ) : null}
      {text ? (
        <p className={styles.pageText}>{text}</p>
      ) : (
        <p className={styles.boxNote}>No text on this page.</p>
      )}
    </Fragment>
  ));
}

/**
 * @param {{ id: string, document: { id: number, kind: 'file' | 'note', title: string,
 *   updatedAt?: Date | string, createdAt?: Date | string } }} props id: the box's, which the
 *   name button controls
 */
export default function DocumentText({ id, document }) {
  const text = useDocumentBody(document);
  if (text.status === 'loading') {
    return (
      <div id={id} className={styles.box} aria-busy="true">
        <p className={styles.boxNote}>Loading the text…</p>
      </div>
    );
  }
  if (text.status === 'error') {
    return (
      <div id={id} className={styles.box}>
        <p className={styles.boxError} role="alert">
          {text.message}
        </p>
        <button type="button" className={styles.retry} onClick={text.retry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div
      id={id}
      className={`${styles.box} ${styles.textBox}`}
      role="region"
      aria-label={`Text of ${document.title}`}
      tabIndex={0}
    >
      <TextPages body={text.body} kind={document.kind} />
    </div>
  );
}
