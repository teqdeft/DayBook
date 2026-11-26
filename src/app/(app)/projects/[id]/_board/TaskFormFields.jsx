'use client';
// The fields of the New task and Edit task window (CONTRACT 28, New task and Edit task), in the
// prototype's order: the title (focused), "Assign to" (radio chips), Due date and Priority side by
// side (stacked on a phone), Phase full width, the note with its count, then the Files field the
// window passes in. Errors from the API show under their field.
import Field from '@/components/Field';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Textarea from '@/components/Textarea';
import AssignField from './AssignField';
import { NOTE_MAX, PRIORITY_OPTIONS, noteCount, phaseOptions } from './taskFormModel';
import styles from './TaskFormDialog.module.css';

const Optional = ({ children }) => (
  <>
    {children} <span className={styles.optional}>(optional)</span>
  </>
);

/** "P1 critical", "P2", "P3" as one row of radios (a segmented control). */
function PriorityField({ value, onChange }) {
  return (
    <fieldset className={styles.priority}>
      <legend className={styles.legend}>Priority</legend>
      <div className={styles.segment}>
        {PRIORITY_OPTIONS.map((option) => (
          <label key={option.value} className={styles.segmentItem}>
            <input
              type="radio"
              name="task-form-priority"
              value={option.value}
              checked={value === option.value}
              onChange={onChange}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The task title, focused when the window opens. */
function Title({ values, set, errorOf, titleRef }) {
  return (
    <Field label="Task title" htmlFor="task-form-title" error={errorOf('title')}>
      <Input
        id="task-form-title"
        ref={titleRef}
        value={values.title}
        maxLength={200}
        placeholder="For example: Fix the login page"
        autoComplete="off"
        error={Boolean(errorOf('title'))}
        data-autofocus=""
        onChange={set('title')}
      />
    </Field>
  );
}

/** The note with its count past 800 characters. */
function Note({ values, set, errorOf }) {
  return (
    <Field
      label={<Optional>Note</Optional>}
      htmlFor="task-form-note"
      help={noteCount(values.details)}
      error={errorOf('details')}
    >
      <Textarea
        id="task-form-note"
        rows={3}
        maxLength={NOTE_MAX}
        placeholder="Instructions or details for the person doing it"
        value={values.details}
        error={Boolean(errorOf('details'))}
        onChange={set('details')}
      />
    </Field>
  );
}

/** Due date and Priority, side by side. */
function DueAndPriority({ values, set, errorOf }) {
  return (
    <div className={styles.two}>
      <Field
        label={<Optional>Due date</Optional>}
        htmlFor="task-form-due"
        error={errorOf('dueDate')}
      >
        <Input
          id="task-form-due"
          type="date"
          value={values.dueDate}
          error={Boolean(errorOf('dueDate'))}
          onChange={set('dueDate')}
        />
      </Field>
      <PriorityField value={values.priority} onChange={set('priority')} />
    </div>
  );
}

/**
 * @param {{ values: object, set: (key: string) => (event: Event) => void,
 *   error: { field: string | null, message: string }, titleRef: object, task: object | null,
 *   choices: object[], children: import('react').ReactNode }} props task: the one being edited
 *   (editable()), none for a new task; choices: assignChoices(); children: the Files field
 */
export default function TaskFormFields({ values, set, error, titleRef, task, choices, children }) {
  const errorOf = (field) => (error.field === field ? error.message : null);
  const field = { values, set, errorOf };
  return (
    <div className={styles.fields}>
      <Title {...field} titleRef={titleRef} />
      <AssignField
        choices={choices}
        value={values.owner}
        onChange={set('owner')}
        error={errorOf('assigneeId')}
      />
      <DueAndPriority {...field} />
      <Field label="Phase" htmlFor="task-form-phase" error={errorOf('phase')}>
        <Select
          id="task-form-phase"
          options={phaseOptions(task)}
          value={values.phase}
          error={Boolean(errorOf('phase'))}
          onChange={set('phase')}
        />
      </Field>
      <Note {...field} />
      {children}
    </div>
  );
}
