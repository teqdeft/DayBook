'use client';
// The Mark leave dialog's fields and live preview (CONTRACT 25, item 9), split from LeaveDialog:
// Person, First day and Last day, Part of the day (a group: the Field has no htmlFor, the help is
// tied to the Segmented by aria-describedby), Type and Pay, Note, the reason when editing, and the
// preview box (role="status", always in the page so its changes are announced).
import Field from '@/components/Field';
import Input from '@/components/Input';
import Segmented from '@/components/Segmented';
import Select from '@/components/Select';
import Textarea from '@/components/Textarea';
import {
  NOTE_MAX,
  PAY_ITEMS,
  REASON_MAX,
  TYPE_OPTIONS,
  partItems,
  withFromDate,
  withToDate,
} from './leaveForm';
import styles from './LeaveDialog.module.css';

function PreviewBox({ lines }) {
  return (
    <div className={lines.length ? styles.preview : undefined} role="status">
      {lines.map((line) => (
        <p
          key={line.text}
          className={
            line.tone === 'main' ? styles.previewMain : `${styles.note} ${styles[line.tone] ?? ''}`
          }
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}

/** A setter for one field of the form. */
const setField = (update, key) => (event) =>
  update((current) => ({ ...current, [key]: event.target.value }));

/**
 * @param {{ id: string, form: object, update: (change: (form: object) => object) => void,
 *   errors: Record<string, string>, choices: Array<{ id: number, name: string }>,
 *   preset: boolean, editing: boolean, help: string | null,
 *   lines: Array<{ text: string, tone: string }> }} props
 */
export default function LeaveFields({
  id,
  form,
  update,
  errors,
  choices,
  preset,
  editing,
  help,
  lines,
}) {
  const partHelpId = help && !errors.part ? `${id}-part-help` : undefined;
  return (
    <div className={styles.fields}>
      <Field label="Person" htmlFor={`${id}-person`} error={errors.userId}>
        <Select
          id={`${id}-person`}
          value={form.userId}
          disabled={preset}
          required
          onChange={setField(update, 'userId')}
          options={[
            ...(preset ? [] : [{ value: '', label: 'Pick a person' }]),
            ...choices.map((item) => ({ value: String(item.id), label: item.name })),
          ]}
        />
      </Field>
      <div className={styles.row}>
        <Field label="First day" htmlFor={`${id}-from`} error={errors.fromDate}>
          <Input
            id={`${id}-from`}
            type="date"
            value={form.fromDate}
            required
            onChange={(event) => update((current) => withFromDate(current, event.target.value))}
          />
        </Field>
        <Field label="Last day" htmlFor={`${id}-to`} error={errors.toDate}>
          <Input
            id={`${id}-to`}
            type="date"
            min={form.fromDate || undefined}
            value={form.toDate}
            onChange={(event) => update((current) => withToDate(current, event.target.value))}
          />
        </Field>
      </div>
      <Field
        label="Part of the day"
        error={errors.part}
        help={partHelpId ? <span id={partHelpId}>{help}</span> : null}
      >
        <Segmented
          label="Part of the day"
          className={styles.full}
          items={partItems(form)}
          value={form.part}
          onChange={(part) => update((current) => ({ ...current, part }))}
          aria-describedby={partHelpId}
        />
      </Field>
      <div className={styles.row}>
        <Field label="Type" htmlFor={`${id}-type`} error={errors.leaveType}>
          <Select
            id={`${id}-type`}
            value={form.leaveType}
            options={TYPE_OPTIONS}
            onChange={setField(update, 'leaveType')}
          />
        </Field>
        <Field label="Pay" error={errors.paid}>
          <Segmented
            label="Pay"
            className={styles.full}
            items={PAY_ITEMS}
            value={form.pay}
            onChange={(pay) => update((current) => ({ ...current, pay }))}
          />
        </Field>
      </div>
      <Field
        label="Note"
        htmlFor={`${id}-note`}
        error={errors.note}
        help={errors.note ? null : 'Only HR and Admins see the note.'}
      >
        <Textarea
          id={`${id}-note`}
          rows={2}
          maxLength={NOTE_MAX}
          value={form.note}
          onChange={setField(update, 'note')}
        />
      </Field>
      {editing ? (
        <Field
          label="Reason for the change"
          htmlFor={`${id}-reason`}
          error={errors.reason}
          help={errors.reason ? null : 'Saved in the audit log.'}
        >
          <Textarea
            id={`${id}-reason`}
            rows={2}
            maxLength={REASON_MAX}
            value={form.reason}
            required
            data-autofocus
            onChange={setField(update, 'reason')}
          />
        </Field>
      ) : null}
      <PreviewBox lines={lines} />
    </div>
  );
}
