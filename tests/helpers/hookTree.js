// Runs client components as plain functions in node (no jsdom, CONTRACT 28 Tests): React's hooks
// are stood in for by a store kept in call order, so a test renders a tree, calls an element's
// handler, and renders again to see the new state. Effects don't run. A test file mocks 'react'
// with `reactWithHooks` and renders with `render`:
//
//   vi.mock('react', async (original) =>
//     (await import('../helpers/hookTree.js')).reactWithHooks(await original()));
//
// This file imports nothing from React, so the mock factory can load it.

export const hookState = { states: [], index: 0 };

/** Forgets every hook's state (a fresh mount). */
export function resetHooks() {
  hookState.states = [];
  hookState.index = 0;
}

function slot(init) {
  const index = hookState.index;
  hookState.index += 1;
  if (!(index in hookState.states)) hookState.states[index] = init();
  return index;
}

/** React with useState, useRef, useMemo and friends kept in `hookState`; effects do nothing. */
export function reactWithHooks(actual) {
  return {
    ...actual,
    useState(initial) {
      const index = slot(() => (typeof initial === 'function' ? initial() : initial));
      const set = (next) => {
        const now = hookState.states[index];
        hookState.states[index] = typeof next === 'function' ? next(now) : next;
      };
      return [hookState.states[index], set];
    },
    useRef(initial) {
      return hookState.states[slot(() => ({ current: initial }))];
    },
    useMemo(make) {
      return make();
    },
    useCallback(fn) {
      return fn;
    },
    useId() {
      return 'hook-id';
    },
    useTransition() {
      return [false, (fn) => fn()];
    },
    useEffect() {},
    useLayoutEffect() {},
  };
}

const isFunctionComponent = (node) =>
  node &&
  typeof node === 'object' &&
  typeof node.type === 'function' &&
  !node.type.prototype?.render;

/** The tree with every function component called (class and forwardRef ones left as they are). */
export function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object') return node;
  if (isFunctionComponent(node)) return expand(node.type(node.props ?? {}));
  if (node.props && 'children' in node.props) {
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  return node;
}

/** Renders `component` with `props` from the first hook on. */
export function render(component, props = {}) {
  hookState.index = 0;
  return expand({ type: component, props });
}

/** Every element of a tree, depth first. */
export function elementsOf(node, found = []) {
  if (Array.isArray(node)) node.forEach((child) => elementsOf(child, found));
  else if (node && typeof node === 'object' && node.props) {
    found.push(node);
    elementsOf(node.props.children, found);
  }
  return found;
}

/** The elements whose props match `test`. */
export const findAll = (tree, test) => elementsOf(tree).filter((element) => test(element.props));

/** The text of a tree, as a screen reader would string it together. */
export function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}
