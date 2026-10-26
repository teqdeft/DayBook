'use client';
// A settings time field: shows "9:30 AM" and tidies what was typed ("17:30" -> "5:30 PM") on blur.
// Checked against CLOCKS (settingsValues.js) on save.
import Input from '@/components/Input';
import FormField from './FormField';
import { useSettingsForm } from './SettingsProvider';
import { clockText, parseClockText } from './timeText';

/** @param {{ name: string, label: string, help?: string, className?: string }} props */
export default function ClockField({ name, label, help, className }) {
  const { form, errors, setField } = useSettingsForm();
  const id = `settings-${name}`;
  return (
    <FormField
      label={label}
      htmlFor={id}
      help={errors[name] ? undefined : help}
      error={errors[name]}
      className={className}
    >
      <Input
        id={id}
        name={name}
        value={form[name]}
        error={Boolean(errors[name])}
        inputMode="text"
        autoComplete="off"
        maxLength={12}
        placeholder="9:30 AM"
        onChange={(event) => setField(name, event.target.value)}
        onBlur={() => {
          const clock = parseClockText(form[name]);
          if (clock && clockText(clock) !== form[name]) setField(name, clockText(clock));
        }}
      />
    </FormField>
  );
}
