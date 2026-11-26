'use client';
// Centered dialog (check-out with report pending, request a project, decline with reason, ...).
// Same header, body and footer style as the Drawer. Since 1.13 (CONTRACT 28, Motion) it plays its
// exit: focus returns and the scroll lock ends the moment it closes, while its picture fades for
// --dur-out, inert and out of the way of clicks (`data-closing`); one open when the page loads
// (a deep link) shows without its entrance (`data-instant`).
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { DUR } from '@/lib/motion/tokens';
import { useHeldValue, useWindowPresence } from '@/lib/motion/presence';
import { useIsClient, useModal } from './useModal';
import styles from './Dialog.module.css';

/** The title, the description and the close button. */
function DialogHeader({ title, description, titleId, descriptionId, onClose }) {
  return (
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
  );
}

/** The body and the footer, inside one form when the dialog submits. */
function DialogContent({ children, footer, onSubmit }) {
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
  if (!onSubmit) return content;
  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {content}
    </form>
  );
}

/**
 * @param {{
 *   open: boolean, onClose: () => void, title: import('react').ReactNode,
 *   description?: import('react').ReactNode, footer?: import('react').ReactNode,
 *   children?: import('react').ReactNode, width?: number, tone?: 'default' | 'danger',
 *   onSubmit?: (event: import('react').FormEvent<HTMLFormElement>) => void, className?: string,
 * }} props
 */
export default function Dialog(props) {
  const { open, onClose } = props;
  const { title, description, width = 480, ...rest } = useHeldValue(open, props);
  const isClient = useIsClient();
  const panelRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  // The panel only exists once mounted in the browser, so a modal that is open on the first
  // render (a deep link) still gets focus, the trap and the scroll lock after hydration.
  useModal({ open: open && isClient, onClose, panelRef });
  const presence = useWindowPresence(open, isClient, DUR.out);

  if (!presence.rendered || !isClient) return null;

  return createPortal(
    <div className={styles.root} data-dialog-root {...presence.marks}>
      <div className={styles.overlay} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`${styles.panel} ${rest.className ?? ''}`}
        style={{ '--dialog-w': `${width}px` }}
        onAnimationEnd={presence.onAnimationEnd}
      >
        <DialogHeader
          title={title}
          description={description}
          titleId={titleId}
          descriptionId={descriptionId}
          onClose={onClose}
        />
        <DialogContent footer={rest.footer} onSubmit={rest.onSubmit}>
          {rest.children}
        </DialogContent>
      </div>
    </div>,
    document.body,
  );
}
