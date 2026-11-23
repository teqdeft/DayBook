'use client';
// Settings -> Attendance marks (CONTRACT 25, items 3 and 4): when a finished day is a Half day or
// a Short day, how early a check-out shows Left early, and the day the payroll month starts on.
// Saved with "Save changes".
import NumberField from './NumberField';
import Section from './Section';
import styles from './SettingsForm.module.css';

export default function AttendanceMarksSection() {
  return (
    <Section
      id="attendance-marks"
      title="Attendance marks"
      subtitle="How Attendance marks half days, short days and early check-outs, and when the payroll month starts."
    >
      <div className={styles.grid2}>
        <NumberField
          name="halfDayUnderMinutes"
          label="Half day when worked under (minutes)"
          help="Worked time is present time less breaks. 270 is 4h 30m. 0 turns it off."
          maxLength={3}
        />
        <NumberField
          name="shortDayUnderMinutes"
          label="Short day when worked under (minutes)"
          help="480 is 8h. 0 turns it off."
          maxLength={3}
        />
        <NumberField
          name="leftEarlyGraceMinutes"
          label="Left early grace (minutes)"
          help="Checking out more than this before their shift ends shows Left early."
          maxLength={3}
        />
        <NumberField
          name="payrollMonthStartDay"
          label="Payroll month starts on day"
          help="1 for calendar months. 26 runs from the 26th to the 25th and is named after the month it ends in."
          maxLength={2}
        />
      </div>
    </Section>
  );
}
