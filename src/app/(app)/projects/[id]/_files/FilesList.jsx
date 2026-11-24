'use client';
// The Files tab's list (CONTRACT 27, Files tab): one card with the place's rows (a phase's own
// items, then "On tasks in Design (3)"; On tasks grouped under each task's title, a button that
// opens the task window), or the place's empty state. Managers can drop files on it (desktop): the
// overlay "Drop to add to Design" shows, and the drop opens Upload files with those files ready,
// so who can see them is always chosen before anything is sent.
import { Fragment, useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import FileListRow from './FileListRow';
import { dropLabel } from './filesTabView';
import styles from './FilesTab.module.css';

const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/**
 * Files dragged over the list: the overlay while over it, the files when dropped. Files dropped
 * anywhere else on the page are swallowed, so the browser never opens one in place of Daybook.
 */
function useListDrop(onFiles, enabled) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    const swallow = (event) => {
      if (hasFiles(event)) event.preventDefault();
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, [enabled]);
  if (!enabled) return { over: false, handlers: {} };
  const onOver = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!over) setOver(true);
  };
  return {
    over,
    handlers: {
      onDragEnter: onOver,
      onDragOver: onOver,
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOver(false);
      },
      onDrop: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(false);
        onFiles(event.dataTransfer.files);
      },
    },
  };
}

function GroupHeading({ heading, onOpenTask }) {
  if (!heading) return null;
  if (heading.task) {
    return (
      <h3 className={styles.subhead}>
        <button
          type="button"
          className={styles.link}
          onClick={(event) => onOpenTask(heading.task.id, event)}
        >
          {heading.task.title}
        </button>
        <span className={styles.subheadNote}>{heading.phase}</span>
      </h3>
    );
  }
  return (
    <h3 className={styles.subhead}>
      {heading.text} <span className={styles.subheadCount}>({heading.count})</span>
    </h3>
  );
}

function Empty({ empty, onUpload, onClear }) {
  let action = null;
  if (empty.action === 'upload') {
    action = (
      <Button icon={<Upload size={18} strokeWidth={1.8} />} onClick={onUpload}>
        Upload files
      </Button>
    );
  } else if (empty.action === 'clear') {
    action = (
      <Button variant="secondary" onClick={onClear}>
        Clear search
      </Button>
    );
  }
  return <EmptyState className={styles.empty} title={empty.text} action={action} />;
}

/**
 * @param {{ view: object, place: string, canManage: boolean, canDrop: boolean,
 *   onOpen: (item: object, event: import('react').MouseEvent) => void,
 *   onOpenTask: (taskId: number, event?: import('react').MouseEvent) => void,
 *   onAction: (action: string, item: object, event?: import('react').MouseEvent) => void,
 *   onUpload: () => void,
 *   onClear: () => void, onDropFiles: (files: FileList) => void }} props view: placeView's;
 *   canDrop: a manager with storage set up
 */
export default function FilesList({ view, place, canManage, canDrop, ...on }) {
  const drop = useListDrop(on.onDropFiles, canDrop);
  return (
    <Card className={`${styles.list} ${drop.over ? styles.dragIn : ''}`} {...drop.handlers}>
      {view.empty ? (
        <Empty empty={view.empty} onUpload={on.onUpload} onClear={on.onClear} />
      ) : (
        view.groups.map((group) => (
          <Fragment key={group.key}>
            <GroupHeading heading={group.heading} onOpenTask={on.onOpenTask} />
            <ul className={styles.rows}>
              {group.items.map((item) => (
                <FileListRow
                  key={item.key}
                  item={item}
                  place={place}
                  canManage={canManage}
                  onOpen={on.onOpen}
                  onOpenTask={on.onOpenTask}
                  onAction={on.onAction}
                />
              ))}
            </ul>
          </Fragment>
        ))
      )}
      {canDrop ? (
        <div className={styles.drop} aria-hidden="true">
          <Upload size={20} strokeWidth={1.8} />
          {dropLabel(place)}
        </div>
      ) : null}
    </Card>
  );
}
