'use client';
// One project of Today's to-do (CONTRACT 24): its label and a trash button that removes it with
// its lines ("Project removed." with Undo; refused while it has hours in the report), the "Still
// open from past reports" box while it has suggestions, its lines, and "Add a task". A typed title
// already on the project is not added twice; one equal to a suggestion is carried from it.
import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import ProjectLabel from '@/components/ProjectLabel';
import { useToast } from '@/components/ToastProvider';
import { TODO_LIMITS } from '@/modules/reports/todoText';
import CarrySuggestions from '../report/CarrySuggestions';
import TodoAddInput from './TodoAddInput';
import TodoLine, { SHORT_TITLE } from './TodoLine';
import {
  addedToTodayText,
  groupKey as keyOf,
  groupName,
  hasTitle,
  suggestionFor,
} from './todoModel';
import styles from './TodoGroup.module.css';

const NONE = [];

const oneLine = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** The project's trash button, or "Add project" while the project is hidden. */
function projectFocus(key, addProjectId) {
  return () =>
    document.querySelector(`[data-todo-group="${key}"] [data-remove-project]`) ??
    document.getElementById(addProjectId);
}

/** A suggestion as a line's "From Wednesday". */
const carriedFrom = (item) => ({ workDate: item.workDate, dayLabel: item.dayLabel });

/**
 * @param {{ group: object, first: boolean, todo: object, suggestions?: object[],
 *   priority?: object[], focusRef: { current: string | null }, carry: { onClosed: Function,
 *   onRestored: Function }, addProjectId: string,
 *   onPaste: (text: string, groupKey: string) => void }} props todo: the page's to-do (useTodo);
 *   suggestions: this project's open suggestions; priority: its open priority tasks; focusRef: the
 *   group whose "Add a task" takes focus next (a project just picked); onPaste: several lines
 *   pasted into "Add a task" (the lines without a heading go to this project)
 */
export default function TodoGroup({
  group,
  first,
  todo,
  suggestions = NONE,
  priority = NONE,
  focusRef,
  carry,
  addProjectId,
  onPaste,
}) {
  const toast = useToast();
  const inputRef = useRef(null);
  const key = keyOf(group);
  const name = groupName(group);
  const taken = new Set(group.lines.map((line) => Number(line.projectTaskId)).filter(Boolean));

  useEffect(() => {
    if (focusRef.current !== key) return;
    focusRef.current = null;
    inputRef.current?.focus();
  });

  /** A typed line: false keeps the text (too short), true clears it (already there). */
  function add(text) {
    const title = oneLine(text);
    if (title.length < TODO_LIMITS.titleMin) {
      toast({ title: SHORT_TITLE, tone: 'error' });
      return false;
    }
    if (hasTitle(group, title)) {
      toast({ title: 'Already in your to-do.' });
      return true;
    }
    const match = suggestionFor(suggestions, title);
    return todo.addLine(group, {
      title,
      status: match?.status,
      carriedFrom: match ? carriedFrom(match) : null,
    });
  }

  /**
   * "Add to today" or "Add all to today". From the keyboard, an add that empties the box (whose
   * buttons go with it) moves focus to "Add a task", so it never falls to the page.
   */
  function addSuggestions(items, event) {
    if (event?.detail === 0 && items.length >= suggestions.length) inputRef.current?.focus();
    if (items.length === 1) {
      const [item] = items;
      todo.addLine(group, {
        title: item.title,
        status: item.status,
        carriedFromTaskId: item.taskId,
        carriedFrom: carriedFrom(item),
        added: addedToTodayText(1),
      });
      return;
    }
    const lines = items.map((item) => ({
      title: item.title,
      status: item.status,
      carriedFrom: carriedFrom(item),
    }));
    todo.addLines([{ target: group, lines }], addedToTodayText);
  }

  const label = group.project ?? { ...group.request, color: null };
  return (
    <div
      className={`${styles.group} ${first ? '' : styles.groupLine}`}
      role="group"
      aria-label={name}
      data-todo-group={key}
    >
      <div className={styles.groupHead}>
        <ProjectLabel project={label} />
        <button
          type="button"
          className={`${styles.act} ${styles.trash}`}
          aria-label={`Remove ${name}`}
          title="Remove project"
          data-remove-project
          onClick={(event) =>
            todo.removeProject(group, {
              keyboard: event.detail === 0,
              returnFocus: projectFocus(key, addProjectId),
            })
          }
        >
          <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <CarrySuggestions
        items={suggestions}
        className={styles.box}
        onAdd={(item, event) => addSuggestions([item], event)}
        onAddAll={addSuggestions}
        onClosed={carry.onClosed}
        onRestored={(item) => carry.onRestored(item, key)}
      />
      {group.lines.length ? (
        <ul className={styles.lines} aria-label={`Tasks on ${name}`}>
          {group.lines.map((line) => (
            <TodoLine key={line.id} line={line} group={group} groupKey={key} todo={todo} />
          ))}
        </ul>
      ) : null}
      <TodoAddInput
        name={name}
        groupKey={key}
        priority={priority}
        taken={taken}
        inputRef={inputRef}
        onAdd={add}
        onPick={(item) => todo.addLine(group, { title: item.title, projectTaskId: item.id })}
        onPaste={(text) => onPaste(text, key)}
      />
    </div>
  );
}
