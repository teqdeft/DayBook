'use client';
// A card's files line (CONTRACT 28, Cards and the card menu): up to 2 chips of the files the viewer
// may see on the task (chipsForTasks: pictures with a thumbnail first), then "+1" when there are
// more. A picture is a 42 px button with its thumbnail that opens the picture viewer with the card's
// pictures; any other file is a chip with its type tile and its name cut with "…", not a button (a
// click on it opens the task like the rest of the card). Thumbnails load lazily and never start a
// native image drag (that would cancel the pointer drag).
import { createElement, useState } from 'react';
import FileTile from '@/components/files/FileTile';
import PictureViewer from '@/components/files/PictureViewer';
import { plural } from '@/lib/text';
import styles from './CardParts.module.css';

/** At most this many chips on a card. */
export const CARD_CHIPS = 2;

const isThumb = (chip) => Boolean(chip?.isPicture && chip.thumbUrl);

/**
 * A picture's 40 × 30 thumbnail: lazy, and never a native image drag. A plain `img` (a signed-in
 * file route, not a static asset for next/image), made with createElement: the board's size check
 * lints these folders without Next's plugin, so a lint comment naming its rule can't stand here.
 */
const Thumb = ({ src }) =>
  createElement('img', { src, alt: '', loading: 'lazy', decoding: 'async', draggable: false });

/**
 * What the files line shows: the chips (pictures with a thumbnail first, as the server sends
 * them), how many more there are, and the pictures the viewer steps through.
 * @param {{ count?: number, chips?: object[] } | null | undefined} files the task's `files`
 * @returns {{ chips: object[], more: number, count: number, pictures: object[] } | null} null
 *   when the viewer may see no file on the task
 */
export function cardFilesOf(files) {
  const all = Array.isArray(files?.chips) ? files.chips : [];
  const count = Math.max(Number(files?.count) || 0, all.length);
  if (count === 0) return null;
  const chips = [...all.filter(isThumb), ...all.filter((chip) => !isThumb(chip))].slice(
    0,
    CARD_CHIPS,
  );
  return { chips, more: count - chips.length, count, pictures: chips.filter(isThumb) };
}

/** @param {{ task: object }} props task: a board row with `files: { count, chips }` */
export default function CardFiles({ task }) {
  const [shown, setShown] = useState(null);
  const line = cardFilesOf(task.files);
  if (!line) return null;
  const total = `${line.count} ${plural(line.count, 'file')}`;
  return (
    <div className={styles.files}>
      {line.chips.map((chip) =>
        isThumb(chip) ? (
          <button
            key={chip.id}
            type="button"
            className={`${styles.fileChip} ${styles.picture}`}
            aria-label={`Open picture ${chip.name}`}
            title={chip.name}
            onClick={() => setShown(line.pictures.indexOf(chip))}
          >
            <Thumb src={chip.thumbUrl} />
          </button>
        ) : (
          <span key={chip.id} className={styles.fileChip} title={chip.name}>
            <FileTile file={chip} box={24} />
            <span className={styles.fileName}>{chip.name}</span>
          </span>
        ),
      )}
      {line.more > 0 ? (
        <span className={`${styles.fileChip} ${styles.more}`} title={total}>
          +{line.more}
        </span>
      ) : null}
      {shown !== null ? (
        <PictureViewer
          files={line.pictures}
          index={shown}
          onIndex={setShown}
          onClose={() => setShown(null)}
        />
      ) : null}
    </div>
  );
}
