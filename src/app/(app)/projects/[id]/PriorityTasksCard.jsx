'use client';
// "Priority tasks" card: the project's open priority tasks (P1, P2, P3, then oldest), each with
// who it is for and the latest status reported on it, and a collapsed "Done" list below. The
// project's PM and Admin add, edit, mark done / reopen and delete; anyone else reads.
import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Users } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import Menu from '@/components/Menu';
import PriorityTag from '@/components/PriorityTag';
import Tag from '@/components/Tag';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { plural } from '@/lib/text';
import { DeletePriorityTaskDialog, PriorityTaskDialog } from './PriorityTaskDialog';
import styles from './PriorityTasksCard.module.css';

const REPORT_TAGS = {
  done: { tone: 'green', label: 'Done' },
  in_progress: { tone: 'primary', label: 'In progress' },
  blocked: { tone: 'red', label: 'Blocked' },
};

// Details longer than this start folded to two lines.
const LONG_DETAILS = 140;

function Assignee({ assignee }) {
  if (!assignee) {
    return (
      <div className={styles.assignee}>
        <span className={styles.anyoneIcon} aria-hidden="true">
          <Users size={15} strokeWidth={1.8} />
        </span>
        <span className={styles.anyone}>Anyone on the project</span>
      </div>
    );
  }
  return (
    <div className={styles.assignee}>
      <Avatar user={assignee} size={28} />
      <span className={styles.person}>
        <span className={styles.name}>{assignee.name}</span>
        {assignee.away ? <span className={styles.away}>{assignee.away}</span> : null}
      </span>
    </div>
  );
}

function Latest({ task }) {
  if (task.status === 'done') {
    return <p className={styles.latestText}>{task.doneLabel ?? 'Done'}</p>;
  }
  if (!task.latest) return <p className={styles.noUpdate}>No updates yet</p>;
  const tag = REPORT_TAGS[task.latest.status] ?? REPORT_TAGS.in_progress;
  return (
    <p className={styles.latestText}>
      <span className="visually-hidden">Latest report: </span>
      <Tag tone={tag.tone}>{tag.label}</Tag>
      <span className={styles.latestWho}>{task.latest.label}</span>
    </p>
  );
}

function Details({ text }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!text) return null;
  const long = text.length > LONG_DETAILS;
  return (
    <>
      <p id={id} className={`${styles.details} ${long && !open ? styles.folded : ''}`}>
        {text}
      </p>
      {long ? (
        <button
          type="button"
          className={styles.more}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </>
  );
}

function TaskRow({ task, actions }) {
  return (
    <li className={`${styles.row} ${task.status === 'done' ? styles.doneRow : ''}`}>
      <PriorityTag priority={task.priority} size="md" className={styles.tagCell} />
      <div className={styles.main}>
        <p className={styles.title}>{task.title}</p>
        <Details text={task.details} />
      </div>
      <Assignee assignee={task.assignee} />
      <div className={styles.latest}>
        <Latest task={task} />
      </div>
      <div className={styles.actions}>{actions}</div>
    </li>
  );
}

/** Mark done / reopen right from the row menu. */
function useStatusChange() {
  const router = useRouter();
  const toast = useToast();
  return async function change(task, status) {
    try {
      await api.post(`/api/project-tasks/${task.id}/status`, { status });
      toast({
        title: status === 'done' ? 'Marked done' : 'Reopened',
        body: task.title,
      });
      router.refresh();
    } catch (error) {
      toast({ title: "Couldn't change the task", body: error.message, tone: 'error' });
    }
  };
}

/**
 * Links to /projects/:id#priority (the Projects row menu, notifications) land on this card. It
 * streams in after the browser's own jump to the anchor, so scroll to it once it is here.
 */
function useScrollToAnchor(id) {
  useEffect(() => {
    if (window.location.hash !== `#${id}`) return;
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [id]);
}

function subtitleFor({ open, canManage, project }) {
  if (open === 0) return 'The tasks that matter most on this project, P1 first.';
  const count = `${open} open, P1 first.`;
  return canManage
    ? `${count} People see the ones for them on Today.`
    : `${count} ${project.pmName ?? 'The project manager'} manages them.`;
}

/**
 * @param {{ project: { id, name, pmName, status }, tasks: object[], members: Array<{ id, name }>,
 *   canManage: boolean }} props tasks: open and done, P1 first then oldest
 */
export default function PriorityTasksCard({ project, tasks, members, canManage }) {
  const [dialog, setDialog] = useState(null); // { kind: 'add' | 'edit' | 'delete', task? }
  const [showDone, setShowDone] = useState(false);
  const changeStatus = useStatusChange();
  const doneId = useId();
  useScrollToAnchor('priority');
  const open = tasks.filter((task) => task.status === 'open');
  const done = tasks.filter((task) => task.status === 'done');
  const canAdd = canManage && project.status !== 'completed';
  const close = () => setDialog(null);

  const menuFor = (task) =>
    canManage ? (
      <Menu
        label={`Actions for ${task.title}`}
        items={[
          ...(task.status === 'open'
            ? [
                { label: 'Edit', onSelect: () => setDialog({ kind: 'edit', task }) },
                { label: 'Mark done', onSelect: () => changeStatus(task, 'done') },
              ]
            : [
                { label: 'Reopen', onSelect: () => changeStatus(task, 'open') },
                { label: 'Edit', onSelect: () => setDialog({ kind: 'edit', task }) },
              ]),
          { label: 'Delete', tone: 'danger', onSelect: () => setDialog({ kind: 'delete', task }) },
        ]}
      />
    ) : null;

  const addButton = canAdd ? (
    <Button
      variant="secondary"
      size="compact"
      icon={<Plus size={18} strokeWidth={1.8} />}
      onClick={() => setDialog({ kind: 'add' })}
    >
      Add priority task
    </Button>
  ) : null;

  return (
    <Card
      as="section"
      padding="none"
      id="priority"
      aria-labelledby="priority-tasks-title"
      className={styles.card}
    >
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 id="priority-tasks-title" className={styles.cardTitle}>
            Priority tasks
          </h2>
          <p className={styles.subtitle}>
            {subtitleFor({ open: open.length, canManage, project })}
            {canManage && project.status === 'completed'
              ? ' This project is completed, so no new ones can be added.'
              : ''}
          </p>
        </div>
        {open.length > 0 ? addButton : null}
      </div>

      {open.length > 0 ? (
        <ul className={styles.list} aria-label="Open priority tasks">
          {open.map((task) => (
            <TaskRow key={task.id} task={task} actions={menuFor(task)} />
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          className={styles.empty}
          title={done.length > 0 ? 'Every priority task is done.' : 'No priority tasks yet.'}
          body={
            canManage
              ? 'Add what matters most and mark it P1, P2 or P3. The people it is for see it on Today.'
              : `${project.pmName ?? 'The project manager'} adds them when something matters most.`
          }
          action={addButton}
        />
      )}

      {done.length > 0 ? (
        <div className={styles.doneSection}>
          <button
            type="button"
            className={styles.doneToggle}
            aria-expanded={showDone}
            aria-controls={doneId}
            onClick={() => setShowDone(!showDone)}
          >
            <ChevronRight
              size={18}
              strokeWidth={1.8}
              aria-hidden="true"
              className={`${styles.chevron} ${showDone ? styles.chevronOpen : ''}`}
            />
            Done
            <span className={styles.doneCount}>{done.length}</span>
            <span className="visually-hidden">{plural(done.length, 'task')}</span>
          </button>
          <ul id={doneId} className={styles.list} hidden={!showDone} aria-label="Done">
            {done.map((task) => (
              <TaskRow key={task.id} task={task} actions={menuFor(task)} />
            ))}
          </ul>
        </div>
      ) : null}

      {dialog?.kind === 'add' || dialog?.kind === 'edit' ? (
        <PriorityTaskDialog
          project={project}
          task={dialog.task}
          members={members}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeletePriorityTaskDialog task={dialog.task} onClose={close} />
      ) : null}
    </Card>
  );
}
