'use client';
// The New project / Edit project drawer (artboard 07). It also creates a project from a project
// request ("Create project" on Requests), filled from the request.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Drawer from '@/components/Drawer';
import Field from '@/components/Field';
import Input from '@/components/Input';
import PersonChip from '@/components/PersonChip';
import Segmented from '@/components/Segmented';
import Select from '@/components/Select';
import Toggle from '@/components/Toggle';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import ClientCombobox from './ClientCombobox';
import ColorSwatches from './ColorSwatches';
import PeoplePicker from './PeoplePicker';
import styles from './ProjectDrawer.module.css';

const STATUS_ITEMS = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
];

function initialValues({ mode, project, request, managers, viewer }) {
  const ownPm = managers.some((person) => person.id === viewer.id) ? viewer.id : managers[0]?.id;
  if (mode === 'edit') {
    return {
      name: project.name,
      clientName: project.clientName ?? '',
      pmId: project.pmId,
      members: project.members ?? [],
      status: project.status,
      color: project.color,
      isUrgent: Boolean(project.isUrgent),
      urgentNote: project.urgentNote ?? '',
    };
  }
  return {
    name: request?.name ?? '',
    clientName: '',
    pmId: ownPm ?? '',
    members: request?.requester ? [request.requester] : [],
    status: 'active',
    color: 'blue',
    isUrgent: false,
    urgentNote: '',
  };
}

/** PM choices: the ones the viewer may pick, plus the project's current PM (who may be HR). */
function managerOptions(managers, project) {
  const options = managers.map((person) => ({ value: person.id, label: person.name }));
  if (project && !options.some((option) => option.value === project.pmId)) {
    options.unshift({ value: project.pmId, label: project.pmName ?? 'Current project manager' });
  }
  return options;
}

export default function ProjectDrawer({
  mode,
  project,
  request,
  managers,
  people,
  viewer,
  onClose,
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState(() =>
    initialValues({ mode, project, request, managers, viewer }),
  );
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const editing = mode === 'edit';
  const pmOptions = managerOptions(managers, editing ? project : null);

  function set(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }

  function setStatus(status) {
    // Only active projects can be urgent.
    setValues((current) => ({
      ...current,
      status,
      isUrgent: status === 'active' ? current.isUrgent : false,
    }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors({});
    setFormError('');
    const body = {
      name: values.name,
      clientName: values.clientName,
      pmId: Number(values.pmId) || null,
      memberIds: values.members.map((person) => person.id),
      status: values.status,
      color: values.color,
      isUrgent: values.isUrgent,
      urgentNote: values.isUrgent ? values.urgentNote : '',
    };
    try {
      if (mode === 'edit') {
        await api.patch(`/api/projects/${project.id}`, body);
        toast({ title: 'Changes saved', body: `${values.name.trim()} is up to date.` });
      } else if (mode === 'request') {
        await api.post(`/api/project-requests/${request.id}/approve`, body);
        toast({
          title: 'Project created',
          body: `${request.requester?.name ?? 'The requester'} can log hours to it now.`,
        });
      } else {
        await api.post('/api/projects', body);
        toast({ title: 'Project created', body: `${values.name.trim()} is ready for reports.` });
      }
      onClose();
      router.refresh();
    } catch (error) {
      const fields = error.fields ?? {};
      setErrors(fields);
      const shown = ['name', 'clientName', 'pmId', 'memberIds', 'status', 'color', 'isUrgent'];
      const urgentShown = fields.urgentNote && values.isUrgent;
      if (!shown.some((key) => fields[key]) && !urgentShown) setFormError(error.message);
      // Someone else handled the request or removed the project meanwhile: show the list as it is.
      if (error.code === 'REQUEST_ALREADY_HANDLED' || error.status === 404) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const statusItems = editing
    ? [...STATUS_ITEMS, { value: 'completed', label: 'Completed' }]
    : STATUS_ITEMS;

  return (
    <Drawer
      open
      onClose={onClose}
      title={editing ? 'Edit project' : 'New project'}
      onSubmit={onSubmit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {editing ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {mode === 'request' ? (
          <p className={styles.fromRequest}>
            {request.requester?.name ?? 'Someone'} asked for this project. They are added to the
            team, and hours they logged to the request move to it.
          </p>
        ) : null}
        <Field label="Project name" htmlFor="project-name" error={errors.name}>
          <Input
            id="project-name"
            value={values.name}
            maxLength={120}
            autoComplete="off"
            placeholder="For example: acme-blog"
            error={Boolean(errors.name)}
            onChange={(event) => set('name', event.target.value)}
          />
        </Field>
        <Field
          label="Client"
          htmlFor="project-client"
          error={errors.clientName}
          className={styles.clientField}
        >
          <ClientCombobox
            id="project-client"
            value={values.clientName}
            error={Boolean(errors.clientName)}
            onChange={(value) => set('clientName', value)}
          />
        </Field>
        <Field
          label="Project manager"
          htmlFor="project-pm"
          error={errors.pmId}
          className={styles.pmField}
        >
          <Select
            id="project-pm"
            value={values.pmId}
            error={Boolean(errors.pmId)}
            onChange={(event) => set('pmId', Number(event.target.value))}
            options={
              values.pmId === ''
                ? [{ value: '', label: 'Pick a project manager' }, ...pmOptions]
                : pmOptions
            }
          />
        </Field>
        <div className={styles.group} role="group" aria-labelledby="project-members-label">
          <p id="project-members-label" className={styles.groupLabel}>
            Team members
          </p>
          <div className={styles.members}>
            {values.members.map((person) => (
              <PersonChip
                key={person.id}
                user={person}
                className={styles.chip}
                onRemove={() =>
                  set(
                    'members',
                    values.members.filter((member) => member.id !== person.id),
                  )
                }
              />
            ))}
            <PeoplePicker
              people={people}
              selectedIds={values.members.map((person) => person.id)}
              onAdd={(person) => set('members', [...values.members, person])}
            />
          </div>
          {errors.memberIds ? (
            <p className={styles.error} role="alert">
              {errors.memberIds}
            </p>
          ) : null}
        </div>
        <div className={styles.group} role="group" aria-labelledby="project-status-label">
          <p id="project-status-label" className={styles.groupLabel}>
            Status
          </p>
          <Segmented
            label="Status"
            items={statusItems}
            value={values.status}
            onChange={setStatus}
            className={styles.segmented}
          />
          {errors.status ? (
            <p className={styles.error} role="alert">
              {errors.status}
            </p>
          ) : null}
        </div>
        <div className={styles.group} role="radiogroup" aria-labelledby="project-color-label">
          <p id="project-color-label" className={styles.groupLabel}>
            Colour label
          </p>
          <ColorSwatches
            value={values.color}
            onChange={(color) => set('color', color)}
            className={styles.swatches}
          />
          {errors.color ? (
            <p className={styles.error} role="alert">
              {errors.color}
            </p>
          ) : null}
        </div>
        <div className={styles.urgent}>
          <Toggle
            id="project-urgent"
            label="Mark as urgent"
            help={
              values.status === 'active'
                ? 'Members get a Slack message and it shows at the top of their day.'
                : 'Only active projects can be marked urgent.'
            }
            checked={values.isUrgent}
            disabled={values.status !== 'active'}
            onChange={(checked) => set('isUrgent', checked)}
            className={styles.urgentToggle}
          />
          {values.isUrgent ? (
            <Field
              label="What is urgent?"
              htmlFor="project-urgent-note"
              error={errors.urgentNote}
              className={styles.urgentNote}
            >
              <Input
                id="project-urgent-note"
                value={values.urgentNote}
                maxLength={200}
                autoComplete="off"
                placeholder="For example: Homepage content live today"
                error={Boolean(errors.urgentNote)}
                onChange={(event) => set('urgentNote', event.target.value)}
              />
            </Field>
          ) : null}
          {errors.isUrgent ? (
            <p className={styles.error} role="alert">
              {errors.isUrgent}
            </p>
          ) : null}
        </div>
        {formError ? (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
