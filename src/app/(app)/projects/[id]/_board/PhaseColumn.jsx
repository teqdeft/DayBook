'use client';
// One column of the Board (CONTRACT 27, Columns): the phase's name, its tag (Current; Done or
// Skipped on an opened done phase), the PM's "⋯" (Files for Development, Edit dates, Make this the
// current phase), its dates and late note; the open cards, then "› 6 done" with the done ones, then
// "+ Add task". NoPhaseColumn draws "No phase yet": no tag, dates, menu or Add task, and no card can
// be dropped on it.
import { CalendarDays, ChevronRight, Flag, Paperclip, X } from 'lucide-react';
import Menu from '@/components/Menu';
import Tag from '@/components/Tag';
import { foldButtonId } from './boardView';
import QuickAdd from './QuickAdd';
import TaskCard from './TaskCard';
import styles from './Board.module.css';

const TAGS = {
  current: { tone: 'primary', text: 'Current' },
  done: { tone: 'green', text: 'Done' },
  skipped: { tone: 'neutral', text: 'Skipped' },
};
const NOTE_TONES = { red: styles.toneRed, marigold: styles.toneMarigold, muted: styles.toneMuted };
const icon = (Icon) => <Icon size={16} strokeWidth={1.8} aria-hidden="true" />;

/** The PM's "⋯" on a phase column. */
function ColumnMenu({ column, board }) {
  return (
    <Menu
      label={`More for ${column.label}`}
      triggerClassName={styles.toolButton}
      width={240}
      items={[
        {
          label: `Files for ${column.label}`,
          icon: icon(Paperclip),
          href: `/projects/${board.projectId}?tab=files&place=${column.key}`,
        },
        {
          label: 'Edit dates',
          icon: icon(CalendarDays),
          onSelect: () => board.editDates(column.key),
        },
        {
          label: 'Make this the current phase',
          icon: icon(Flag),
          disabled: column.status === 'current',
          onSelect: () => board.movePhase(column.key),
        },
      ]}
    />
  );
}

function Header({ column, board }) {
  const tag = TAGS[column.tag];
  const manage = board.access === 'manage';
  return (
    <div className={styles.columnHead}>
      <div className={styles.columnTitle}>
        <h3 className={styles.columnName}>{column.label}</h3>
        {tag ? (
          <Tag tone={tag.tone} className={styles.columnTag}>
            {tag.text}
          </Tag>
        ) : null}
        {manage || column.folded ? (
          <span className={styles.columnTools}>
            {manage ? <ColumnMenu column={column} board={board} /> : null}
            {column.folded ? (
              <button
                type="button"
                className={`${styles.toolButton} ${styles.hideOnPhone}`}
                aria-label={`Hide ${column.label} tasks`}
                onClick={() => board.toggleOpened(column.key)}
              >
                <X size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {column.dates || column.note ? (
        <p className={styles.columnDates}>
          {column.dates}
          {column.dates && column.note ? ' · ' : null}
          {column.note ? (
            <span className={NOTE_TONES[column.note.tone]}>{column.note.text}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** The column's cards, the dashed gap where a dragged card would land among the open ones. */
function Cards({ cards, board, gapAt }) {
  const items = cards.map((task) => (
    <TaskCard key={task.id} task={task} board={board} {...board.cardProps(task)} />
  ));
  if (gapAt !== null && gapAt !== undefined) {
    items.splice(gapAt, 0, <li key="gap" className={styles.gap} aria-hidden="true" />);
  }
  return <ul className={styles.cards}>{items}</ul>;
}

function DoneFold({ column, board }) {
  if (column.done.length === 0) return null;
  const open = board.isFoldOpen(column);
  return (
    <>
      <button
        type="button"
        id={foldButtonId(column.key)}
        className={styles.fold}
        aria-expanded={open}
        onClick={() => board.toggleFold(column)}
      >
        <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
        <span className="num">{column.done.length}</span> done
      </button>
      {open ? <Cards cards={column.done} board={board} /> : null}
    </>
  );
}

const widthClass = { slim: styles.slim, current: styles.current, normal: null };

/**
 * @param {{ column: object, board: object }} props column: boardView.boardColumns'; board:
 *   useBoard's shared values and actions
 */
export default function PhaseColumn({ column, board }) {
  const drop = board.columnDrop(column);
  const classes = [
    styles.column,
    widthClass[column.width],
    column.hidden ? styles.foldedAway : null,
    board.step === column.key ? styles.selected : null,
    drop.over ? styles.dropOn : null,
  ]
    .filter(Boolean)
    .join(' ');
  const canAdd = board.access === 'manage' && board.status !== 'completed';
  return (
    <section
      className={classes}
      aria-label={column.label}
      data-column={column.key}
      {...drop.handlers}
    >
      <Header column={column} board={board} />
      {column.total === 0 ? <p className={styles.emptyText}>{column.emptyText}</p> : null}
      {column.open.length > 0 || drop.gapAt !== null ? (
        <Cards cards={column.open} board={board} gapAt={drop.gapAt} />
      ) : null}
      <DoneFold column={column} board={board} />
      {canAdd ? (
        <QuickAdd
          projectId={board.projectId}
          column={column}
          open={board.quick === column.key}
          onOpen={() => board.openQuick(column.key)}
          onClose={() => board.closeQuick(column.key)}
          onAdded={board.quickAdded}
          onMore={board.quickMore}
        />
      ) : null}
    </section>
  );
}

/** "No phase yet": tasks from before phases, open ones first, all shown. */
export function NoPhaseColumn({ column, board }) {
  const classes = [
    styles.column,
    styles.noPhase,
    board.step === column.key ? styles.selected : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section className={classes} aria-label={column.label} data-column={column.key}>
      <div className={styles.columnHead}>
        <div className={styles.columnTitle}>
          <h3 className={styles.columnName}>{column.label}</h3>
        </div>
        {board.access === 'manage' ? (
          <p className={styles.columnDates}>
            Tasks from before phases. Move each one to its phase.
          </p>
        ) : null}
      </div>
      <Cards cards={[...column.open, ...column.done]} board={board} />
    </section>
  );
}
