// The shared Field, held on one render path so its control never remounts while someone types.
// Field clones its control (which gives it a different React key) only while it has help or error
// text, so an input is replaced, and loses focus and keystrokes, the moment its error appears or
// clears. Always passing a help node keeps Field on the cloning path; an empty help line takes no
// space. Used by Settings and the People drawer; drop it once Field clones consistently.
import Field from '@/components/Field';
import styles from './FormField.module.css';

/** Same props as Field. */
export default function FormField({ help, className, ...rest }) {
  return (
    <Field
      {...rest}
      help={help || <></>}
      className={[styles.field, className].filter(Boolean).join(' ')}
    />
  );
}
