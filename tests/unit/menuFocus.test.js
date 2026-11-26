// A focus rule of 1.12 (CONTRACT 27, Look, phone and accessibility), with React's hooks stood in
// for so the component runs as a plain function: the shared Menu hands the item's click to
// onSelect, so a row's Delete chosen with Enter or Space (detail 0) can give its Undo toast the
// focus. Split from keyboardFocus.test.js by CONTRACT 28, Files and owners (the task form's Save
// with a paused file is in taskFormFocus.test.js). From 1.13 (CONTRACT 28, the board's Filter
// menu): checkbox items (`role="menuitemcheckbox"`, `aria-checked`, a check) that may keep the
// menu open, and extra trigger attributes.
import { describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ menuOpen: false }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal();
  const noop = () => {};
  return {
    ...actual,
    // The Menu's one state is where its list sits: open at once when menuOpen.
    useState: (initial) => [
      hooks.menuOpen ? { top: 0, left: 0 } : typeof initial === 'function' ? initial() : initial,
      noop,
    ],
    useRef: (initial) => ({ current: initial }),
    useId: () => 'menu-1',
    useEffect: noop,
    useLayoutEffect: noop,
  };
});
vi.mock('next/link', () => ({ default: () => null }));

const { default: Menu } = await import('@/components/Menu.jsx');

/** Every element of a rendered tree, depth first. */
function elementsOf(node, found = []) {
  if (Array.isArray(node)) node.forEach((child) => elementsOf(child, found));
  else if (node && typeof node === 'object' && node.props) {
    found.push(node);
    elementsOf(node.props.children, found);
  }
  return found;
}

describe('the Menu', () => {
  it("hands the item's click to onSelect, so Enter or Space can be told from a tap", () => {
    hooks.menuOpen = true;
    const chosen = [];
    const items = [
      { label: 'Edit details', onSelect: (event) => chosen.push(['edit', event]) },
      { label: 'Delete', tone: 'danger', onSelect: (event) => chosen.push(['delete', event]) },
    ];
    const tree = Menu({ label: 'More for brief.pdf', items });
    hooks.menuOpen = false;
    const entries = elementsOf(tree).filter((element) => element.props.role === 'menuitem');
    expect(entries).toHaveLength(2);
    const keyboard = { detail: 0 };
    entries[1].props.onClick(keyboard);
    expect(chosen).toEqual([['delete', keyboard]]);
  });

  it('never calls onSelect for a disabled item', () => {
    hooks.menuOpen = true;
    const onSelect = vi.fn();
    const tree = Menu({ label: 'More', items: [{ label: 'Edit', onSelect, disabled: true }] });
    hooks.menuOpen = false;
    elementsOf(tree)
      .find((element) => element.props.role === 'menuitem')
      .props.onClick({ detail: 0 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('draws a checkbox item with aria-checked and its check, and keeps the menu open', () => {
    hooks.menuOpen = true;
    const onSelect = vi.fn();
    const items = [
      { label: 'Critical (4)', checked: true, keepOpen: true, onSelect },
      { label: 'Overdue (2)', checked: false, keepOpen: true, onSelect },
      { label: 'Open', onSelect },
    ];
    const tree = Menu({ label: 'Filter', items, childrenName: true, children: 'Filter' });
    hooks.menuOpen = false;
    const found = elementsOf(tree);
    const boxes = found.filter((element) => element.props.role === 'menuitemcheckbox');
    expect(boxes.map((element) => element.props['aria-checked'])).toEqual([true, false]);
    expect(found.filter((element) => element.props.role === 'menuitem')).toHaveLength(1);
    boxes[1].props.onClick({ detail: 0 });
    expect(onSelect).toHaveBeenCalledTimes(1);
    // the children name the trigger: no hidden copy of the label beside them
    const trigger = found.find((element) => element.props['aria-haspopup'] === 'menu');
    expect(elementsOf(trigger.props.children).some((one) => one.props?.className)).toBe(false);
  });

  it('draws a line above an item that asks for one, never above the first', () => {
    hooks.menuOpen = true;
    const tree = Menu({
      label: 'More',
      items: [
        { label: 'Open', separator: true },
        { label: 'Edit' },
        { label: 'Delete', tone: 'danger', separator: true },
      ],
    });
    hooks.menuOpen = false;
    const roles = elementsOf(tree)
      .map((element) => element.props.role)
      .filter((role) => role === 'menuitem' || role === 'separator');
    expect(roles).toEqual(['menuitem', 'menuitem', 'separator', 'menuitem']);
  });

  it('puts extra attributes on the trigger', () => {
    const tree = Menu({
      label: '2 more people',
      items: [],
      triggerProps: { 'aria-pressed': true, title: '2 more people' },
    });
    const trigger = elementsOf(tree).find((element) => element.props['aria-haspopup'] === 'menu');
    expect(trigger.props).toMatchObject({ 'aria-pressed': true, 'aria-label': '2 more people' });
  });
});
