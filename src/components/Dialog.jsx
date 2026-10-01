'use client';
// Centered dialog (check-out with report pending, request a project, decline with reason, ...).
// Same header, body and footer style as the Drawer.
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useIsClient, useModal } from './useModal';
import styles from './Dialog.module.css';

/**
 * @param {{
 *   open: boolean, onClose: () => void, title: import('react').ReactNode,
 *   description?: import('react').ReactNode, footer?: import('react').ReactNode,
 *   children?: import('react').ReactNode, width?: number, tone?: 'default' | 'danger',
 *   onSubmit?: (event: import('react').FormEvent<HTMLFormElement>) => void, className?: string,
 * }} props
 */
export default function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  width = 480,
  onSubmit,
  className = '',
}) {
  const isClient = useIsClient();
  const panelRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  // The panel only exists once mounted in the browser, so a modal that is open on the first
  // render (a deep link) still gets focus, the trap and the scroll lock after hydration.
  useModal({ open: open && isClient, onClose, panelRef });

  if (!open || !isClient) return null;

  const content = (
    <>
      {children ? (
        <div className={styles.body} data-modal-body>
          {children}
        </div>
      ) : (
        <div data-modal-body hidden />
      )}
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
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`${styles.panel} ${className}`}
        style={{ '--dialog-w': `${width}px` }}
      >
        <div className={styles.header}>
          <div className={styles.heading}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            ) : null}
          </div>
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
