'use client';
// A task's other files as rows (CONTRACT 27, Task window; CONTRACT 28): at least 52 px, the type
// tile in its kind's colour, the name (cut in the middle), "Word · 86 KB" (a linked project file
// adds " · From Files: Design"), and a Download icon that is a plain link (`<a href>` without
// `download`, never fetch and a Blob), so the browser writes straight to disk, shows its own
// progress and can resume. A program file gets "Program file. Open it only if you trust where it
// came from." on its own line. Managers on a project page get an X ("Remove brief.pdf"; a linked
// file "Remove checkout-flow.docx from this task").
import { Download, X } from 'lucide-react';
import { isProgram, formatSize, typeLabel } from '@/modules/projectFiles/kinds';
import { extOf } from '@/modules/projectFiles/names';
import { isPhase, phaseLabel } from '@/modules/projectPlan/phases';
import FileName from './FileName';
import FileTile from './FileTile';
import styles from './Files.module.css';

export const PROGRAM_LINE = 'Program file. Open it only if you trust where it came from.';

/** " · From Files: Design" (" · From Files: Whole project") for a linked file, else nothing. */
export const fromFiles = (file) =>
  file?.linked
    ? ` · From Files: ${isPhase(file.phase) ? phaseLabel(file.phase) : 'Whole project'}`
    : '';

/** The X's words: "Remove brief.pdf", or "Remove checkout-flow.docx from this task" (a link). */
export const removeLabel = (file) =>
  file.linked ? `Remove ${file.name} from this task` : `Remove ${file.name}`;

/**
 * @param {{ files: object[], showTask?: boolean, onOpenTask?: (taskId: number) => void,
 *   onRemove?: (file: object) => void }} props files: ProjectFiles; showTask: name the task of
 *   a task file ("On task: Fix the login page", a button that opens it); onRemove: the X,
 *   managers on a project page only (the caller unlinks a `linked` file, removes an own one)
 */
export default function FileRows({ files, showTask = false, onOpenTask, onRemove }) {
  if (!files?.length) return null;
  return (
    <ul className={styles.rows}>
      {files.map((file) => {
        const ext = file.ext ?? extOf(file.name);
        const task = showTask && file.task ? file.task : null;
        return (
          <li key={`${file.linked ? 'link' : 'file'}-${file.id}`} className={styles.row}>
            <FileTile file={file} />
            <span className={styles.rowText}>
              <span className={styles.chipName} title={file.name}>
                <FileName name={file.name} />
              </span>
              <span className={styles.meta}>
                {file.typeLabel ?? typeLabel(ext)} · {formatSize(file.sizeBytes)}
                {fromFiles(file)}
                {task ? (
                  <>
                    {' · On task: '}
                    <button
                      type="button"
                      className={styles.taskLink}
                      onClick={() => onOpenTask?.(task.id)}
                    >
                      {task.title}
                    </button>
                  </>
                ) : null}
              </span>
              {isProgram(ext) ? <span className={styles.meta}>{PROGRAM_LINE}</span> : null}
            </span>
            <a
              className={styles.iconButton}
              href={file.downloadUrl}
              aria-label={`Download ${file.name}`}
              title={`Download ${file.name}`}
            >
              <Download size={18} strokeWidth={1.8} aria-hidden="true" />
            </a>
            {onRemove ? (
              <button
                type="button"
                className={styles.iconButton}
                aria-label={removeLabel(file)}
                title={removeLabel(file)}
                onClick={(event) => onRemove(file, event)}
              >
                <X size={18} strokeWidth={1.8} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
