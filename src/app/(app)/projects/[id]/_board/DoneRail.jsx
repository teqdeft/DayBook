'use client';
// The Done phases rail (CONTRACT 28, Done phases rail and columns), at the board's left when any
// phase before the current one has all its tasks done. Closed (72 px): one button with a green
// check, "Done phases" and the count ("Requirement gathering, Design. Show them." for a screen
// reader). Open (220 px): the heading, "Fold the done phases" and one tile per phase (1.12's
// tiles: a green check, or the neutral "Skipped" tag for a phase jumped over; "6 of 6 tasks", a
// member's "4 of yours, done"; the late note; "Show tasks" opens its tasks as a column until
// "Hide tasks"). Open or closed is remembered (useBoardView). Not shown on a phone.
import { Check, ChevronLeft } from 'lucide-react';
import Tag from '@/components/Tag';
import { RAIL_BUTTON_ID, railHiddenText, tileButtonId } from './boardView';
import layout from './Board.module.css';
import styles from './DoneRail.module.css';

/** The rail's green check, a path that can draw (`pathLength="1"`, the phase move's count). */
function RailCheck() {
  return (
    <svg
      className={styles.check}
      data-check="rail"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 6 9 17l-5-5" pathLength="1" />
    </svg>
  );
}

function Tile({ tile, onToggle }) {
  return (
    <li className={styles.tile} data-tile={tile.key}>
      <span className={styles.tileName}>
        {tile.skipped ? null : <Check size={16} strokeWidth={2.4} aria-hidden="true" />}
        <span>{tile.label}</span>
        {tile.skipped ? (
          <Tag tone="neutral" className={styles.skippedTag}>
            Skipped
          </Tag>
        ) : null}
      </span>
      <span className={styles.line}>{tile.text}</span>
      {tile.note ? <span className={`${styles.line} ${styles.late}`}>{tile.note}</span> : null}
      <button
        type="button"
        id={tileButtonId(tile.key)}
        className={styles.toggle}
        aria-expanded={tile.opened}
        onClick={() => onToggle(tile.key)}
      >
        {tile.opened ? 'Hide' : 'Show'}
        <span className="visually-hidden"> {tile.label}</span> tasks
      </button>
    </li>
  );
}

/** Open: the heading, the fold button and the tiles. */
function OpenRail({ tiles, board }) {
  return (
    <>
      <div className={styles.head}>
        <h3 className={styles.title}>Done phases</h3>
        <button
          type="button"
          id={RAIL_BUTTON_ID}
          className={styles.fold}
          aria-expanded="true"
          aria-label="Fold the done phases"
          title="Fold the done phases"
          onClick={board.toggleRail}
        >
          <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <ul className={styles.tiles}>
        {tiles.map((tile) => (
          <Tile key={tile.key} tile={tile} onToggle={board.toggleOpened} />
        ))}
      </ul>
    </>
  );
}

/** @param {{ board: object }} props board: useBoard's (`tiles`, `railOpen`, `toggleRail`) */
export default function DoneRail({ board }) {
  const { tiles } = board;
  if (tiles.length === 0) return null;
  const open = board.railOpen;
  return (
    <section
      className={`${layout.rail} ${styles.rail}`}
      aria-label="Done phases"
      data-flip="rail"
      data-open={open ? '' : undefined}
    >
      <span className={styles.box} data-rail-box="" aria-hidden="true" />
      {open ? (
        <OpenRail tiles={tiles} board={board} />
      ) : (
        <button
          type="button"
          id={RAIL_BUTTON_ID}
          className={styles.open}
          aria-expanded="false"
          onClick={board.toggleRail}
        >
          <RailCheck />
          <span>
            Done
            <br />
            phases
          </span>
          <span className={styles.count} data-rail-n="">
            {tiles.length}
          </span>
          <span className="visually-hidden">{railHiddenText(tiles)}</span>
        </button>
      )}
    </section>
  );
}
