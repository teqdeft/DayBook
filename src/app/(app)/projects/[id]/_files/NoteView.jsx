'use client';
// The note window (CONTRACT 27, Files tab, Note window; from 1.11's DocumentText): the title, the
// meta line, then the text as plain text, never HTML, a document's pages split by a line with the
// page number. A text-only document says its file wasn't kept; "View text" on a project file shows
// the text read for the AI summary. Managers get Edit (notes) and Delete in the footer.
import { Fragment } from 'react';
import { Info, Pencil, Trash2 } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { textPages } from '../documentsView';
import { useDocumentBody } from '../useDocumentBody';
import windowStyles from '../projectWindows.module.css';
import { noteWindowMeta, windowDocument } from './filesTabView';
import styles from './FileDialogs.module.css';

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
        <p className={styles.text}>{text}</p>
      ) : (
        <p className={styles.quiet}>No text on this page.</p>
      )}
    </Fragment>
  ));
}

function NoteText({ document }) {
  const text = useDocumentBody(document);
  if (text.status === 'loading') {
    return (
      <p className={styles.quiet} aria-busy="true">
        Loading the text…
      </p>
    );
  }
  if (text.status === 'error') {
    return (
      <div>
        <p className={styles.error} role="alert">
          {text.message}
        </p>
        <Button variant="secondary" size="small" className={styles.retry} onClick={text.retry}>
          Try again
        </Button>
      </div>
    );
  }
  return <TextPages body={text.body} kind={document.kind} />;
}

function Footer({ item, canManage, onClose, onEdit, onDelete }) {
  const own = canManage && (item.type === 'note' || item.type === 'text');
  return (
    <>
      {own ? (
        <Button
          variant="danger"
          className={styles.left}
          icon={<Trash2 size={16} strokeWidth={1.8} />}
          onClick={(event) => onDelete(item, event)}
        >
          Delete
        </Button>
      ) : null}
      {own && item.type === 'note' ? (
        <Button
          variant="secondary"
          className={styles.second}
          icon={<Pencil size={16} strokeWidth={1.8} />}
          onClick={() => onEdit(item)}
        >
          Edit
        </Button>
      ) : null}
      <Button variant="secondary" className={styles.second} onClick={onClose}>
        Close
      </Button>
    </>
  );
}

/**
 * @param {{ item: object | null, canManage: boolean, onClose: () => void,
 *   onEdit: (item: object) => void,
 *   onDelete: (item: object, event: import('react').MouseEvent) => void }} props item: a note, a
 *   text-only document, or a project file with its text (filesItems); null when closed
 */
export default function NoteView({ item, canManage, onClose, onEdit, onDelete }) {
  const document = item ? windowDocument(item) : null;
  return (
    <Dialog
      open={Boolean(item && document)}
      onClose={onClose}
      title={item?.name ?? ''}
      description={item ? <span className={styles.meta}>{noteWindowMeta(item)}</span> : null}
      width={560}
      className={`${styles.panel} ${windowStyles.window}`}
      footer={
        item ? (
          <Footer
            item={item}
            canManage={canManage}
            onClose={onClose}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ) : null
      }
    >
      {item?.type === 'text' ? (
        <p className={styles.info}>
          <Info size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>The original file wasn&apos;t kept. Only its text was saved.</span>
        </p>
      ) : null}
      {document ? <NoteText document={document} /> : null}
    </Dialog>
  );
}
