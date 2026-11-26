// A file name on one line, cut in the middle so its end and type stay visible
// ("checkout-err…steps.pdf", CONTRACT 27, Files tab rows and chips): the start shrinks with an
// ellipsis, the last few characters and the extension never do. The two shown parts are boxes of
// their own, so screen readers would read them as two words ("two- pages.pdf"): they are hidden
// from them and the whole name is read once instead (never selected, so a copy has it once).
// React escapes the name.
import styles from './FileName.module.css';

/**
 * Where the name is cut: before the last 5 characters of the base name and the extension, or the
 * last 9 characters of a name without one.
 * @param {string} name
 * @returns {[string, string]}
 */
export function nameParts(name) {
  const text = String(name ?? '');
  const dot = text.lastIndexOf('.');
  const cut = dot > 8 ? dot - 5 : Math.max(0, text.length - 9);
  return [text.slice(0, cut), text.slice(cut)];
}

/** @param {{ name: string }} props */
export default function FileName({ name }) {
  const [head, tail] = nameParts(name);
  return (
    <span className={styles.fileName}>
      <span className={styles.nameHead} aria-hidden="true">
        {head}
      </span>
      <span className={styles.nameTail} aria-hidden="true">
        {tail}
      </span>
      <span className={`visually-hidden ${styles.nameWhole}`}>{String(name ?? '')}</span>
    </span>
  );
}
