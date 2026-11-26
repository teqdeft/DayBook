'use client';
// The project files linked in the New task and Edit task window (CONTRACT 28, New task and Edit
// task, Files; Linking and the share confirm): the task's saved links (Edit, from its details), the
// files picked in "From project files", the saved ones marked "Removed when you save", the ones
// struck as "No longer in Files" after a save found them deleted, and what the picker's share
// confirm covered (for whom, which files). It says what a save links and unlinks.
import { useCallback, useState } from 'react';
import { privateFiles } from '@/components/files/shareConfirmView';

const idsOf = (files) => files.map((file) => Number(file.id));
const withIds = (now, ids) => [...new Set([...now, ...ids])];

/**
 * The link chips in order and what a save does with them (pure).
 * @param {{ saved: object[], picked: object[], removedIds: number[], goneIds: number[] }} state
 */
export function linkState({ saved, picked, removedIds, goneIds }) {
  const existingIds = idsOf(saved);
  const all = [...saved, ...picked.filter((file) => !existingIds.includes(Number(file.id)))];
  const kept = all.filter((file) => !removedIds.includes(file.id) && !goneIds.includes(file.id));
  const add = idsOf(picked.filter((file) => !goneIds.includes(file.id)));
  const remove = removedIds.filter((id) => existingIds.includes(Number(id)));
  return { all, kept, existingIds, add, remove, fresh: add.length };
}

/** What the share confirm covered: for whom, which "Only PM and Admins" files. */
function useConfirmed() {
  const [confirmed, setConfirmed] = useState(null);
  const confirm = useCallback((owner, files) => {
    const ids = idsOf(privateFiles(files));
    setConfirmed((now) => ({ owner, ids: now?.owner === owner ? withIds(now.ids, ids) : ids }));
  }, []);
  const clearConfirm = useCallback(() => setConfirmed(null), []);
  return { confirmed, confirm, clearConfirm };
}

/**
 * @param {{ details: { task?: object | null } }} args useTaskDetails' answer (Edit)
 * @returns {{ all: object[], kept: object[], existingIds: number[], removedIds: number[],
 *   goneIds: number[], add: number[], remove: number[], fresh: number,
 *   confirmed: { owner: string, ids: number[] } | null,
 *   pick: (files: object[], confirmedFor?: string | null) => void,
 *   drop: (file: object) => void, keep: (file: object) => void,
 *   markGone: (ids: number[]) => void, clearConfirm: () => void,
 *   confirm: (owner: string, files: object[]) => void }} all: every linked chip in order; kept:
 *   the links the save keeps; add and remove: what it sends; fresh: links not saved yet
 */
export function useFormLinks({ details }) {
  const saved = (details?.task?.files ?? []).filter((file) => file.linked);
  const [picked, setPicked] = useState([]);
  const [removedIds, setRemoved] = useState([]);
  const [goneIds, setGone] = useState([]);
  const share = useConfirmed();
  const state = linkState({ saved, picked, removedIds, goneIds });
  const savedIds = state.existingIds;

  function pick(files, confirmedFor = null) {
    setPicked((now) => [...now, ...files.filter((file) => !now.some((one) => one.id === file.id))]);
    if (confirmedFor !== null) share.confirm(confirmedFor, files);
  }
  function drop(file) {
    if (savedIds.includes(Number(file.id))) setRemoved((now) => [...now, file.id]);
    else setPicked((now) => now.filter((one) => one.id !== file.id));
  }
  return {
    ...state,
    removedIds,
    goneIds,
    ...share,
    pick,
    drop,
    keep: (file) => setRemoved((now) => now.filter((id) => id !== file.id)),
    markGone: (ids) => setGone((now) => withIds(now, ids)),
  };
}
