'use client';
// "Files and notes" in an open phase of the Phases tab (CONTRACT 22), as the prototype: Add file and
// Add note, then this phase's files and notes, newest first. A name opens its text in a small box
// (one at a time); a note is added and edited inline; Delete hides the row at once, with Undo for
// 6 s. The board renders this only for people who can manage the project: another PM's page never
// gets the documents at all, and their text is only ever fetched on click.
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import AddFileButton from './AddFileButton';
import DocumentRow from './DocumentRow';
import NoteForm from './NoteForm';
import { addDocumentIds, deleteCopy, documentButtonId, documentKey } from './documentsView';
import { useUndoDelete } from './useUndoDelete';
import sectionStyles from './PhaseSection.module.css';
import styles from './PhaseDocuments.module.css';

const byId = (...ids) => ids.map((id) => document.getElementById(id)).find(Boolean) ?? null;

/**
 * Puts focus back once the note row has closed: it closes together with the page refresh, so this
 * waits for the render without it.
 */
function useFocusWhenClosed(form) {
  const target = useRef(null); // [id, fallback id]
  useEffect(() => {
    if (form || !target.current) return;
    const ids = target.current;
    target.current = null;
    byId(...ids)?.focus();
  }, [form]);
  return (...ids) => {
    target.current = ids;
  };
}

/** What Delete with Undo needs for a file or note; focus comes back to its row, or else Add note. */
function documentDeletion(item, phase, event) {
  const { label, failTitle } = deleteCopy(item);
  return {
    key: documentKey(item),
    url: `/api/project-documents/${item.id}`,
    label,
    failTitle,
    keyboard: event?.detail === 0,
    returnFocus: () => byId(documentButtonId(item.id, 'delete'), addDocumentIds(phase).note),
  };
}

/** The list's state: the open text box, the one note row and Delete with Undo. */
function useDocuments({ phase }) {
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null); // { noteId: number | null } | null
  const undo = useUndoDelete();
  const focusWhenClosed = useFocusWhenClosed(form);
  return {
    undo,
    form,
    isOpen: (id) => openId === id,
    toggle: (id) => setOpenId(openId === id ? null : id),
    addNote: () => setForm({ noteId: null }),
    editNote: (id) => setForm({ noteId: id }),
    closeForm() {
      const ids = addDocumentIds(phase);
      // After adding, back to Add note; after an edit, to that note's Edit.
      if (form?.noteId) focusWhenClosed(documentButtonId(form.noteId, 'edit'), ids.note);
      else focusWhenClosed(ids.note);
      setForm(null);
    },
    remove(item, event) {
      if (openId === item.id) setOpenId(null);
      undo.remove(documentDeletion(item, phase, event));
    },
  };
}

/** The title, Add file and Add note. */
function Subhead({ projectId, phase, onAddNote }) {
  const ids = addDocumentIds(phase);
  return (
    <div className={sectionStyles.subhead}>
      <h3 className={sectionStyles.subtitle}>Files and notes</h3>
      <span className={styles.addButtons}>
        <AddFileButton projectId={projectId} phase={phase} id={ids.file} />
        <Button
          id={ids.note}
          variant="secondary"
          className={sectionStyles.smallButton}
          icon={<Plus size={16} strokeWidth={1.8} />}
          onClick={onAddNote}
        >
          Add note
        </Button>
      </span>
    </div>
  );
}

/**
 * @param {{ projectId: number, phase: string,
 *   documents: Array<{ id: number, kind: 'file'|'note', title: string, pages: number | null,
 *     pagesTotal: number | null, charCount: number, addedOn: string, updatedOn: string,
 *     createdAt: Date, updatedAt: Date }>,
 *   canManage: boolean, managerName: string | null, today: string }} props documents: this
 *   phase's, newest first, without their text (projectSummaries.listDocuments); addedOn and
 *   updatedOn are company dates; canManage is always true here
 */
export default function PhaseDocuments({ projectId, phase, documents, today }) {
  const list = useDocuments({ phase });
  const { form, undo } = list;
  const shown = documents.filter((item) => !undo.isHidden(documentKey(item)));
  const formFor = (note) => (
    <li key={note ? note.id : 'new'}>
      <NoteForm projectId={projectId} phase={phase} note={note} onClose={list.closeForm} />
    </li>
  );
  const adding = form !== null && form.noteId === null;
  const empty = shown.length === 0 && !adding;
  return (
    <div className={sectionStyles.files}>
      <Subhead projectId={projectId} phase={phase} onAddNote={list.addNote} />
      {empty ? (
        <p className={sectionStyles.note}>No files or notes yet.</p>
      ) : (
        <ul aria-label="Files and notes" className={styles.list}>
          {adding ? formFor(null) : null}
          {shown.map((item) =>
            form?.noteId === item.id ? (
              formFor(item)
            ) : (
              <DocumentRow
                key={item.id}
                document={item}
                today={today}
                open={list.isOpen(item.id)}
                onToggle={() => list.toggle(item.id)}
                onEdit={() => list.editNote(item.id)}
                onDelete={(event) => list.remove(item, event)}
              />
            ),
          )}
        </ul>
      )}
      {undo.toast}
    </div>
  );
}
