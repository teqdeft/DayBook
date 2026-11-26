'use client';
// One column of the Board (CONTRACT 28, Done phases rail and columns): the phase's name, the count
// of open cards, its tag (Current; Done or Skipped on a done phase opened from the rail), the PM's
// "+" (New task in that phase) and "⋯" (Files for Development, Edit dates, Make this the current
// phase), X on an opened done phase, its dates and note; the body (scrolling inside when the board
// fills the window): the open cards (the list is always drawn, so a dragged card has its place
// even in an empty column), the empty line after it, "› 6 done" with the done cards; then "+ Add
// task" (quick add). "No phase yet" (tasks from before phases) has no tag, dates, "+", "⋯" or Add
// task, and no card can be dropped on it. The data attributes are what the motion reads.
import { CalendarDays, ChevronRight, Flag, Paperclip, Plus, X } from 'lucide-react';
import Menu from '@/components/Menu';
import Tag from '@/components/Tag';
import { foldButtonId } from './boardView';
import QuickAdd from './QuickAdd';
import TaskCard from './TaskCard';
import layout from './Board.module.css';
import styles from './Columns.module.css';

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
      triggerClassName={styles.tool}
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
          disabled: column.current,
          onSelect: () => board.movePhase(column.key),
        },
      ]}
    />
  );
}

/** "+" (managers, an open project, not a done phase), "⋯" (managers), X (an opened done phase). */
function Tools({ column, board, canAdd }) {
  const manage = board.access === 'manage';
  if (!manage && !column.finished) return null;
  return (
    <span className={styles.tools}>
      {canAdd ? (
        <button
          type="button"
          className={styles.tool}
          aria-label={`New task in ${column.label}`}
          title={`New task in ${column.label}`}
          onClick={() => board.addTask(column.key)}
        >
          <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
      {manage ? <ColumnMenu column={column} board={board} /> : null}
      {column.finished ? (
        <button
          type="button"
          className={`${styles.tool} ${styles.hideOnPhone}`}
          aria-label={`Hide ${column.label} tasks`}
          title={`Hide ${column.label} tasks`}
          onClick={() => board.toggleOpened(column.key)}
        >
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

function Header({ column, board, canAdd }) {
  const tag = TAGS[column.tag];
  const open = column.open.length;
  const noPhase = column.kind === 'none';
  return (
    <div className={`${layout.columnHead} ${styles.head}`}>
      <div className={styles.titleRow}>
        <h3 className={styles.name}>{column.label}</h3>
        <span className={styles.count} title={`${open} open`}>
          {open}
          <span className="visually-hidden"> open</span>
        </span>
        {tag ? (
          <Tag
            tone={tag.tone}
            className={styles.tag}
            data-current-tag={column.tag === 'current' ? '' : undefined}
          >
            {tag.text}
          </Tag>
        ) : null}
        {noPhase ? null : <Tools column={column} board={board} canAdd={canAdd} />}
      </div>
      <Dates column={column} board={board} />
    </div>
  );
}

/** The second line: the dates and note ("30 Nov to 11 Dec · Started 7 days early"). */
function Dates({ column, board }) {
  if (column.kind === 'none') {
    return board.access === 'manage' ? (
      <p className={styles.dates}>Tasks from before phases. Move each one to its phase.</p>
    ) : null;
  }
  if (!column.dates && !column.note) return null;
  return (
    <p className={styles.dates}>
      {column.dates}
      {column.dates && column.note ? ' · ' : null}
      {column.note ? (
        <span className={NOTE_TONES[column.note.tone]}>{column.note.text}</span>
      ) : null}
    </p>
  );
}

/** "› 6 done" and, while it is open, the done cards; both move with a dragged card's room. */
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
        data-follow=""
        data-flip={`fold:${column.key}`}
        onClick={() => board.toggleFold(column)}
      >
        <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
        <span className="num">{column.done.length}</span> done
      </button>
      {open ? (
        <ul
          className={`${styles.cards} ${styles.doneCards}`}
          data-follow=""
          data-flip={`done:${column.key}`}
        >
          {column.done.map((task) => (
            <TaskCard key={task.id} task={task} board={board} {...board.cardProps(task)} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** The open cards, the empty line after them, the fold. */
function Body({ column, board }) {
  return (
    <div className={`${layout.columnBody} ${styles.body}`} data-column-body="">
      <ul className={styles.cards} data-cards={column.key}>
        {column.open.map((task) => (
          <TaskCard key={task.id} task={task} board={board} {...board.cardProps(task)} />
        ))}
      </ul>
      {column.total === 0 ? (
        <p className={styles.empty} data-empty-text="">
          {column.emptyText}
        </p>
      ) : null}
      <DoneFold column={column} board={board} />
    </div>
  );
}

/** "+ Add task": its own row, which moves with the room only when the board doesn't fill. */
function Foot({ column, board }) {
  return (
    <div
      className={`${layout.columnFoot} ${styles.foot}`}
      data-follow={board.fill ? undefined : ''}
      data-flip={`foot:${column.key}`}
    >
      <QuickAdd
        projectId={board.projectId}
        column={column}
        open={board.quick === column.key}
        onOpen={() => board.openQuick(column.key)}
        onClose={() => board.closeQuick(column.key)}
        onAdded={board.quickAdded}
        onMore={board.quickMore}
      />
    </div>
  );
}

/**
 * @param {{ column: object, board: object }} props column: boardView.boardColumns'; board:
 *   useBoard's shared values and actions
 */
export default function PhaseColumn({ column, board }) {
  const canAdd =
    board.access === 'manage' &&
    board.status !== 'completed' &&
    column.kind === 'phase' &&
    !column.finished;
  const classes = [
    layout.column,
    styles.column,
    column.kind === 'none' ? styles.noPhase : null,
    board.step === column.key ? layout.selected : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section
      className={classes}
      aria-label={column.label}
      data-flip={`col:${column.key}`}
      data-column={column.key}
      hidden={column.hidden || undefined}
    >
      <Header column={column} board={board} canAdd={canAdd} />
      <Body column={column} board={board} />
      {canAdd ? <Foot column={column} board={board} /> : null}
    </section>
  );
}
