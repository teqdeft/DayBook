'use client';
// A whole-number settings field ("5"); the unit is in its label. Shown as text and checked
// against NUMBERS (numberFields.js) on save.
import Input from '@/components/Input';
import FormField from './FormField';
import { useSettingsForm } from './SettingsProvider';

/** @param {{ name: string, label: string, help?: string, maxLength?: number }} props */
export default function NumberField({ name, label, help, maxLength }) {
  const { form, errors, setField } = useSettingsForm();
  const id = `settings-${name}`;
  return (
    <FormField
      label={label}
      htmlFor={id}
      help={errors[name] ? undefined : help}
      error={errors[name]}
    >
      <Input
        id={id}
        name={name}
        value={form[name]}
        error={Boolean(errors[name])}
        inputMode="numeric"
        autoComplete="off"
        maxLength={maxLength}
        onChange={(event) => setField(name, event.target.value)}
        onBlur={() => {
          const trimmed = String(form[name] ?? '').trim();
          if (trimmed !== form[name]) setField(name, trimmed);
        }}
      />
    </FormField>
  );
}
