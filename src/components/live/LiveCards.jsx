'use client';
// The cards' buttons (CONTRACT 26), inside the live provider so the preview actions reach the
// store: Open and Mark as read act as the bell's do, Dismiss only closes, a summary's See them
// opens the bell list (or, without a bell, shows the newest that fit) and Mark these as read (or
// Mark all as read past 20) saves them all. The card closes at once; a failed save toasts.
import PreviewStack from './PreviewStack';
import { usePreviewActions } from './usePreviewActions';

/**
 * @param {{ entries: object[], hidden: boolean, stack: object, sectionRef: object,
 *   store: object, tz: string, maxCards: () => number }} props `stack` is useStack's `api`
 */
export default function LiveCards({ entries, hidden, stack, sectionRef, store, tz, maxCards }) {
  const actions = usePreviewActions();
  if (entries.length === 0) return null;
  const limit = maxCards();

  function onAction(action, entry, event) {
    const item = entry.items[0];
    if (action === 'open') actions.open(item, event);
    else if (action === 'read') actions.markRead(item);
    else if (action === 'read-many') actions.markMany(entry.items.map((n) => n.id));
    else if (action === 'read-all') actions.markAll();
    if (action !== 'see') {
      stack.leave(entry.key);
      return;
    }
    if (store.hasBell()) {
      stack.closeAll({ now: true });
      store.openBell();
      return;
    }
    // The newest that fit, leaving out any read meanwhile (another tab, the bell); see useStack.
    const singles = entry.items.map((one) => ({
      key: `item-${one.id}`,
      kind: 'single',
      items: [one],
    }));
    stack.replace(entry.key, singles, limit);
  }

  return (
    <PreviewStack
      entries={entries}
      hidden={hidden}
      stack={stack}
      sectionRef={sectionRef}
      tz={tz}
      maxCards={limit}
      hasBell={store.hasBell()}
      bellButton={store.bellButton}
      onAction={onAction}
    />
  );
}
