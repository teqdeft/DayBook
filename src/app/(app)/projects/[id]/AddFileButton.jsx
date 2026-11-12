'use client';
// "+ Add file" in "Files and notes" (CONTRACT 22): a real file picker for a PDF, Word .docx, .txt or
// .md. The file is read here, in the browser (readDocumentFile.js), and only its text goes to the
// server; the file itself is never sent or kept. While reading, the button says "Reading page 12 of
// 14…" (or "Reading…"). Leaving the section stops the reading. A failure is a toast with the reason.
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, Plus } from 'lucide-react';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { addedToast } from './documentsView';
import { DocumentReadError, FILE_ACCEPT, readDocumentFile, readingLabel } from './readDocumentFile';
import sectionStyles from './PhaseSection.module.css';
import styles from './PhaseDocuments.module.css';

const READ_FAILED = "Couldn't read the file. Try again.";

/** What the button says: Add file, the page being read, or Adding… while the text is saved. */
function buttonLabel(busy) {
  if (!busy) return 'Add file';
  return busy.adding ? 'Adding…' : readingLabel(busy.progress);
}

/** Reads a picked file and saves its text; `busy` is what the button shows meanwhile. */
function useAddFile({ projectId, phase }) {
  const router = useRouter();
  const toast = useToast();
  const reading = useRef(null); // the AbortController of the file being read
  const [busy, setBusy] = useState(null); // null | { progress } | { adding: true }
  const [, startRefresh] = useTransition();

  useEffect(() => () => reading.current?.abort(), []);

  async function read(file) {
    const controller = new AbortController();
    reading.current = controller;
    setBusy({ progress: null });
    try {
      const text = await readDocumentFile(file, {
        signal: controller.signal,
        onProgress: (progress) => setBusy({ progress }),
      });
      // A .txt or .md is read at once, so it can be done after the section closed: not saved then.
      return controller.signal.aborted ? null : text;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        const title = error instanceof DocumentReadError ? error.message : READ_FAILED;
        toast({ title, tone: 'error' });
      }
      setBusy(null);
      return null;
    } finally {
      reading.current = null;
    }
  }

  async function add(file) {
    const text = await read(file);
    if (!text) return;
    setBusy({ adding: true });
    try {
      const { title, pages, pagesTotal } = text;
      await api.post(`/api/projects/${projectId}/documents`, {
        phase,
        kind: 'file',
        title,
        text: text.text,
        pages,
        pagesTotal,
      });
      toast(addedToast(text));
      startRefresh(() => {
        setBusy(null);
        router.refresh();
      });
    } catch (error) {
      toast({ title: "Couldn't add the file", body: error.message, tone: 'error' });
      setBusy(null);
    }
  }

  return { busy, add };
}

/**
 * @param {{ projectId: number, phase: string, id: string }} props id: the button's, where focus
 *   goes back to
 */
export default function AddFileButton({ projectId, phase, id }) {
  const input = useRef(null);
  const { busy, add } = useAddFile({ projectId, phase });

  function picked(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // so the same file can be picked again
    if (file && !busy) add(file);
  }

  return (
    <>
      <Button
        id={id}
        variant="secondary"
        className={`${sectionStyles.smallButton} ${busy ? styles.busy : ''}`}
        icon={
          busy ? (
            <LoaderCircle className={styles.spinner} size={16} strokeWidth={1.8} />
          ) : (
            <Plus size={16} strokeWidth={1.8} />
          )
        }
        aria-disabled={busy ? true : undefined}
        aria-busy={busy ? true : undefined}
        onClick={() => {
          if (!busy) input.current?.click();
        }}
      >
        {buttonLabel(busy)}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        tabIndex={-1}
        aria-label="File to add"
        accept={FILE_ACCEPT}
        onChange={picked}
      />
    </>
  );
}
