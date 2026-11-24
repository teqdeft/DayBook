'use client';
// Text for the AI summary (CONTRACT 27, Files tab): when a PDF, Word .docx, .txt or .md project file
// of at most 20 MB finishes uploading, the PM's browser reads its text (readDocumentFile, the §22
// rules) and posts it as the file's document. One file at a time, after the uploads. "Read text for
// AI" from the row menu first fetches the file from its download link into memory (the PM's own
// read of a file of at most 20 MB). A failure leaves the file and says why in a toast; at the
// document limit the toast says the text wasn't kept. Leaving the tab stops the reading.
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { plural } from '@/lib/text';
import { READABLE_EXTS } from '@/modules/projectFiles/kinds';
import { addedToast } from '../documentsView';
import { readDocumentFile } from '../readDocumentFile';
import { READ_LIMIT_BYTES } from './filesTabView';

const LIMIT_MESSAGE = 'This project has 100 files and notes with text.';

/** Whether a finished project file is one whose text Daybook reads for the AI. */
export function readsForAi({ ext, size }) {
  return READABLE_EXTS.includes(ext) && size > 0 && size <= READ_LIMIT_BYTES;
}

/** "Reading brief.pdf for the AI summary… page 12 of 14" */
export function readingLine(job) {
  const pages = job.progress ? ` page ${job.progress.page} of ${job.progress.pages}` : '';
  return `Reading ${job.name} for the AI summary…${pages}`;
}

/** "Leave this page? Daybook is still reading 2 files for the AI summary." */
export function readingLeaveMessage(count) {
  return `Leave this page? Daybook is still reading ${count} ${plural(count, 'file')} for the AI summary.`;
}

/**
 * The toast of a read that didn't end with a saved text.
 * @param {unknown} error what reading or saving threw
 * @param {string} name the file's name
 * @returns {{ title: string, body?: string, tone: 'error' }}
 */
export function failureToast(error, name) {
  if (error?.code === 'TOO_MANY_DOCUMENTS') {
    return {
      title: `${name}'s text wasn't kept for the AI summary.`,
      body: LIMIT_MESSAGE,
      tone: 'error',
    };
  }
  // A DocumentReadError carries the §22 reason ("No readable text. Is it a scan? ..."), an API
  // error its own sentence.
  return {
    title: `The AI summary can't read ${name}.`,
    body: error?.message || undefined,
    tone: 'error',
  };
}

/** The file itself: the one just uploaded, else fetched from its download link. */
async function sourceOf(job, signal) {
  if (job.source) return job.source;
  const response = await fetch(job.url, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('This file is missing. Ask your PM to add it again.');
  const blob = await response.blob();
  return new File([blob], job.name, { type: blob.type });
}

/** Reads one file and saves its text; returns the read (for its cut notice). */
async function readOne(job, { projectId, signal, onProgress }) {
  const file = await sourceOf(job, signal);
  const read = await readDocumentFile(file, { signal, onProgress });
  if (signal.aborted) return null;
  await api.post(`/api/projects/${projectId}/documents`, {
    kind: 'file',
    fileId: job.fileId,
    title: read.title,
    text: read.text,
    pages: read.pages,
    pagesTotal: read.pagesTotal,
  });
  return read;
}

/**
 * @param {{ projectId: number, waiting: boolean }} options waiting: uploads are still running, so
 *   reading waits for them
 * @returns {{ rows: object[], add: (job: { fileId: number, name: string, size: number,
 *   ext: string, source?: File, url?: string }) => void, count: number, announcement: string }}
 *   rows: the Uploads card's reading rows (UploadChip items with `state: 'reading'`); count: files
 *   waiting or being read; announcement: the text of the reader's polite region
 */
export function useReadForAi({ projectId, waiting }) {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  const [jobs, setJobs] = useState([]);
  const running = useRef(null); // the AbortController of the file being read

  const add = useCallback((job) => {
    if (!readsForAi(job)) return;
    setJobs((list) =>
      list.some((one) => one.fileId === job.fileId) ? list : [...list, { ...job, progress: null }],
    );
  }, []);

  const next = jobs[0] ?? null;
  useEffect(() => {
    if (!next || waiting || running.current) return;
    const controller = new AbortController();
    running.current = controller;
    const onProgress = (progress) =>
      setJobs((list) => list.map((one) => (one === list[0] ? { ...one, progress } : one)));
    readOne(next, { projectId, signal: controller.signal, onProgress })
      .then(
        (read) => {
          if (read?.notice) toast(addedToast({ title: next.name, notice: read.notice }));
          if (read) startRefresh(() => router.refresh());
        },
        (error) => {
          if (error?.name !== 'AbortError') toast(failureToast(error, next.name));
        },
      )
      .finally(() => {
        if (running.current !== controller) return;
        running.current = null;
        setJobs((list) => list.filter((one) => one.fileId !== next.fileId));
      });
  }, [next, waiting, projectId, router, toast]);

  useEffect(() => () => running.current?.abort(), []);

  const rows = jobs.map((job) => ({
    id: `read-${job.fileId}`,
    name: job.name,
    size: job.size,
    ext: job.ext,
    state: 'reading',
    message: readingLine(job),
  }));
  // The reader's polite milestone: which file it is reading now.
  const announcement = next ? `Reading ${next.name} for the AI summary` : '';
  return { rows, add, count: jobs.length, announcement };
}
