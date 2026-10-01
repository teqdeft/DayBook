'use client';
// Side drawer (New project, Add employee): 460 px from the right over the overlay, a header with
// the title and a close button, a scrolling body and a footer with right-aligned buttons.
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useIsClient, useModal } from './useModal';
import styles from './Drawer.module.css';

/**
 * @param {{
 *   open: boolean, onClose: () => void, title: import('react').ReactNode,
 *   footer?: import('react').ReactNode, children?: import('react').ReactNode, width?: number,
 *   onSubmit?: (event: import('react').FormEvent<HTMLFormElement>) => void, className?: string,
 * }} props
 *   With `onSubmit`, the body and footer sit inside one <form>, so a submit button in the footer
 *   submits it (the form has noValidate; show errors from the API's fields map).
 */
export default function Drawer({
  open,
  onClose,
  title,
  footer,
  children,
  width = 460,
  onSubmit,
  className = '',
}) {
  const isClient = useIsClient();
  const panelRef = useRef(null);
  const titleId = useId();
  // The panel only exists once mounted in the browser, so a modal that is open on the first
  // render (a deep link) still gets focus, the trap and the scroll lock after hydration.
  useModal({ open: open && isClient, onClose, panelRef });

  if (!open || !isClient) return null;

  const content = (
    <>
      <div className={styles.body} data-modal-body>
        {children}
      </div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </>
  );

  return createPortal(
    <div className={styles.root}>
      <div className={styles.overlay} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${styles.panel} ${className}`}
        style={{ '--drawer-w': `${width}px` }}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        {onSubmit ? (
          <form className={styles.form} onSubmit={onSubmit} noValidate>
            {content}
          </form>
        ) : (
          content
        )}
      </div>
    </div>,
    document.body,
  );
}
