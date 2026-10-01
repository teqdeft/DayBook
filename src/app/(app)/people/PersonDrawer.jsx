'use client';
// Add employee / Edit drawer (artboard 10). HR sees the role read-only; Admin can pick it.
// Fields the server won't let this viewer change on this person are shown read-only too.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Drawer from '@/components/Drawer';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { useToast } from '@/components/ToastProvider';
import { api, ApiError } from '@/lib/apiClient';
import { ROLE_LABELS, ROLES } from '@/lib/permissions';
import FormField from '../settings/FormField';
import { dateText, parseDateText, parseShiftText, shiftText } from '../settings/timeText';
import styles from './PersonDrawer.module.css';

const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
const FIELD_KEYS = [
  'name',
  'email',
  'designation',
  'departmentId',
  'reportsToId',
  'joinedOn',
  'shift',
  'role',
];

function initialValues(person, options) {
  const defaultShift = shiftText(options.companyShift.start, options.companyShift.end);
  if (!person) {
    const departmentId = options.departments[0]?.id ?? '';
    return {
      name: '',
      email: '',
      designation: '',
      departmentId: String(departmentId),
      reportsToId: suggestedManager(options, departmentId),
      joinedOn: dateText(options.defaultJoinedOn),
      shift: defaultShift,
      role: 'employee',
    };
  }
  return {
    name: person.name,
    email: person.email,
    designation: person.designation ?? '',
    departmentId: String(person.departmentId ?? ''),
    reportsToId: person.reportsToId ? String(person.reportsToId) : '',
    joinedOn: dateText(person.joinedOn),
    shift: person.shiftStart ? shiftText(person.shiftStart, person.shiftEnd) : defaultShift,
    role: person.role,
  };
}

/** The manager most people in that department report to (or the first PM). */
function suggestedManager(options, departmentId) {
  const id = options.suggestedManagers[String(departmentId)] ?? options.managers[0]?.id;
  return id ? String(id) : '';
}

/** Manager options, keeping a current manager who is no longer a PM or Admin. */
function managerOptions(options, person) {
  const list = options.managers.map((m) => ({ value: String(m.id), label: m.name }));
  if (person?.reportsToId && !list.some((m) => m.value === String(person.reportsToId))) {
    list.push({
      value: String(person.reportsToId),
      label: person.reportsToName ?? 'Their manager',
    });
  }
  return [...list, { value: '', label: 'No one' }];
}

const ASK_OTHERS = 'Only another HR person or an Admin can change it.';
const EMAIL_OWNER = { pm: "a project manager's", hr: "an HR person's" };

/**
 * Fields this viewer can't change on this person, with the reason shown under each (the users
 * service refuses them too). Without roles.manage (HR): the email of a PM or HR account decides
 * who signs in with that role, so only an Admin changes it; and nobody changes their own email,
 * manager, joining date or shift.
 * @returns {Record<string, string>} field name -> help text
 */
function lockedFields(person, options) {
  if (!person || options.canChangeRoles) return {};
  if (person.id === options.viewerId) {
    return {
      email: 'Only an Admin can change your email.',
      reportsToId: ASK_OTHERS,
      joinedOn: ASK_OTHERS,
      shift: ASK_OTHERS,
    };
  }
  if (person.role !== 'employee') {
    const owner = EMAIL_OWNER[person.role] ?? "this person's";
    return { email: `Only an Admin can change ${owner} email.` };
  }
  return {};
}

/** Form text -> API body, or field errors the person can fix before sending. */
function toPayload(values, options, locks = {}) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'Enter their full name.';
  if (!values.email.trim()) errors.email = 'Enter their work email.';
  if (!values.designation.trim()) errors.designation = 'Enter their designation.';
  const joinedOn = parseDateText(values.joinedOn);
  if (joinedOn === undefined) errors.joinedOn = 'Enter a date like 01-10-2026.';
  const shift = parseShiftText(values.shift);
  if (shift === undefined) errors.shiftStart = 'Enter the shift like 9:30 AM to 6:30 PM.';
  else if (shift && shift.end <= shift.start)
    errors.shiftEnd = 'The shift must end after it starts.';
  const isDefault =
    !shift ||
    (shift.start === options.companyShift.start && shift.end === options.companyShift.end);
  const payload = {
    name: values.name,
    email: values.email,
    designation: values.designation,
    departmentId: values.departmentId,
    reportsToId: values.reportsToId || null,
    joinedOn: joinedOn ?? null,
    shiftStart: isDefault ? null : shift.start,
    shiftEnd: isDefault ? null : shift.end,
  };
  // Locked fields are left out, so an unchanged value is never sent back as a change.
  for (const key of Object.keys(locks)) {
    const keys = key === 'shift' ? ['shiftStart', 'shiftEnd'] : [key];
    for (const name of keys) {
      delete payload[name];
      delete errors[name];
    }
  }
  return { payload, errors };
}

/** Moves focus to the first field that has an error, in form order. */
function focusFirstError(errors) {
  const key = FIELD_KEYS.find((name) => errors[name]);
  if (key) document.getElementById(`person-${key}`)?.focus();
}

/** API field keys -> the field that shows them. */
function fieldErrors(fields) {
  const out = { ...fields };
  if (fields.shiftStart || fields.shiftEnd) out.shift = fields.shiftStart ?? fields.shiftEnd;
  return out;
}

export default function PersonDrawer({ person, options, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState(() => initialValues(person, options));
  const [managerTouched, setManagerTouched] = useState(Boolean(person));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(person);
  const defaultShift = shiftText(options.companyShift.start, options.companyShift.end);
  const shiftIsDefault = values.shift.trim() === '' || values.shift.trim() === defaultShift;
  const roleLocked = !options.canChangeRoles;
  const locks = lockedFields(person, options);

  function set(name, value) {
    setValues((current) => {
      const next = { ...current, [name]: value };
      if (name === 'departmentId' && !managerTouched) {
        next.reportsToId = suggestedManager(options, value);
      }
      return next;
    });
    if (name === 'reportsToId') setManagerTouched(true);
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const { payload, errors: local } = toPayload(values, options, locks);
    if (Object.keys(local).length > 0) {
      const shown = fieldErrors(local);
      setErrors(shown);
      focusFirstError(shown);
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      if (isEdit) {
        await api.patch(`/api/users/${person.id}`, payload);
        if (!roleLocked && values.role !== person.role) {
          await api.patch(`/api/users/${person.id}/role`, { role: values.role });
        }
        toast({ title: 'Changes saved', body: `${payload.name.trim()}'s details are up to date.` });
      } else {
        const body = roleLocked ? payload : { ...payload, role: values.role };
        const { data } = await api.post('/api/users', body);
        toast({
          title: `${data.name} added`,
          body: 'They can sign in with Slack using that email.',
        });
      }
      onClose();
      router.refresh();
    } catch (error) {
      setSaving(false);
      const fields = error instanceof ApiError ? fieldErrors(error.fields) : {};
      if (FIELD_KEYS.some((key) => fields[key])) {
        setErrors(fields);
        focusFirstError(fields);
        if (isEdit && fields.role) router.refresh(); // the profile part was saved
        return;
      }
      toast({ title: "Couldn't save", body: error.message, tone: 'error' });
    }
  }

  const text = (name) => ({
    id: `person-${name}`,
    name,
    value: values[name],
    onChange: (event) => set(name, event.target.value),
    error: Boolean(errors[name]),
    disabled: Boolean(locks[name]),
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={isEdit ? 'Edit employee' : 'Add employee'}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {isEdit ? 'Save changes' : 'Add employee'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.info}>
          They sign in with Slack, so use the email on their Slack account.
        </p>
        <FormField label="Full name" htmlFor="person-name" error={errors.name}>
          <Input
            {...text('name')}
            placeholder="For example: Riya Kapoor"
            autoComplete="off"
            maxLength={120}
          />
        </FormField>
        <FormField
          label="Work email"
          htmlFor="person-email"
          help={errors.email ? undefined : locks.email}
          error={errors.email}
        >
          <Input
            {...text('email')}
            type="email"
            placeholder="name@company.com"
            autoComplete="off"
            spellCheck={false}
            maxLength={190}
          />
        </FormField>
        <FormField label="Designation" htmlFor="person-designation" error={errors.designation}>
          <Input
            {...text('designation')}
            placeholder="For example: Frontend developer"
            autoComplete="off"
            maxLength={120}
          />
        </FormField>
        <div className={styles.pair}>
          <FormField label="Department" htmlFor="person-departmentId" error={errors.departmentId}>
            <Select
              {...text('departmentId')}
              options={options.departments.map((d) => ({ value: String(d.id), label: d.name }))}
            />
          </FormField>
          <FormField
            label="Reports to"
            htmlFor="person-reportsToId"
            help={errors.reportsToId ? undefined : locks.reportsToId}
            error={errors.reportsToId}
          >
            <Select {...text('reportsToId')} options={managerOptions(options, person)} />
          </FormField>
        </div>
        <div className={styles.pair}>
          <FormField
            label="Joining date"
            htmlFor="person-joinedOn"
            help={errors.joinedOn ? undefined : locks.joinedOn}
            error={errors.joinedOn}
          >
            <Input
              {...text('joinedOn')}
              placeholder="dd-mm-yyyy"
              inputMode="numeric"
              maxLength={10}
            />
          </FormField>
          <FormField
            label="Shift"
            htmlFor="person-shift"
            help={
              errors.shift
                ? undefined
                : (locks.shift ??
                  (shiftIsDefault ? 'Company default' : 'Clear it to use the company default'))
            }
            error={errors.shift}
          >
            <Input
              {...text('shift')}
              className={shiftIsDefault && !locks.shift ? styles.defaultShift : undefined}
              onFocus={(event) => {
                if (shiftIsDefault) event.target.select();
              }}
              onBlur={() => {
                if (values.shift.trim() === '') set('shift', defaultShift);
              }}
              maxLength={40}
            />
          </FormField>
        </div>
        <FormField
          className={styles.afterHelp}
          label="Role"
          htmlFor="person-role"
          help={roleLocked ? 'Only Admin can change roles.' : undefined}
          error={errors.role}
        >
          <Select {...text('role')} options={ROLE_OPTIONS} disabled={roleLocked} />
        </FormField>
      </div>
    </Drawer>
  );
}
