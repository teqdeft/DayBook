'use client';
// What an uploader says to screen readers (CONTRACT 27, Upload states, Announcements): ONE
// visually hidden polite region per uploader (a progress bar isn't a live region) with the
// milestones "Uploading 3 files", "brief.pdf uploaded", "45% of site-video.mov" (every 25% for files
// over 50 MB), "All files uploaded" and "Upload of brief.pdf cancelled". Failures are the chip's
// own `role="alert"`, once.
import { createElement } from 'react';
import { plural } from '@/lib/text';

/** "45% of site-video.mov" is said at every 25% for files over 50 MB. */
export const ANNOUNCE_BYTES = 50 * 1024 * 1024;

/** "Uploading 3 files" */
export const startedText = (count) => `Uploading ${count} ${plural(count, 'file')}`;

/** "brief.pdf uploaded", with ". All files uploaded" when it was the last one running. */
export const uploadedText = (name, last) => `${name} uploaded${last ? '. All files uploaded' : ''}`;

/** "12 uploads cancelled" (Cancel all). */
export const cancelledAllText = (count) => `${count} ${plural(count, 'upload')} cancelled`;

/**
 * "45% of site-video.mov" when a 25% step was passed between two percents, else null.
 * @param {{ name: string, size: number }} item
 * @param {number} before
 * @param {number} after
 */
export function percentMilestone(item, before, after) {
  if (item.size <= ANNOUNCE_BYTES || after >= 100) return null;
  const step = Math.floor(after / 25) * 25;
  return step > 0 && step > Math.floor(before / 25) * 25 ? `${step}% of ${item.name}` : null;
}

/**
 * The uploader's one polite region; render it once, always (empty is fine), so a change of text
 * is announced.
 * @param {{ text: string }} props
 */
export function UploadAnnouncer({ text }) {
  return createElement('p', { className: 'visually-hidden', role: 'status' }, text);
}
