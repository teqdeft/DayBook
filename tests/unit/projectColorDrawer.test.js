// The project drawer's "Colour label" (CONTRACT 23). ColorSwatches and ProjectDrawer really run:
// the test keeps their React state itself (useState, useRef, useId and useEffect below), so a
// click is a call to the element's handler and a new render, without a browser. "More colours"
// opens and closes its panel, a swatch applies at once and closes it, the button shows a custom
// colour, "Any colour" applies on change and never applies a colour that can't be seen, and Escape
// in the panel closes only the panel: the drawer's real useModal listener never closes the drawer.
// The drawer groups the row, sends the chosen colour and shows the API's error for it.
import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLOR_PROBLEM_MESSAGES, MORE_COLORS } from '@/lib/projectColors';

const hooks = vi.hoisted(() => ({ current: null }));
const apiPatch = vi.hoisted(() => vi.fn());

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal();
  /** The rendering component's next hook, made on its first render. */
  const slot = (make) => {
    const instance = hooks.current;
    const index = instance.index++;
    if (!(index in instance.slots)) instance.slots[index] = make(index);
    return instance.slots[index];
  };
  return {
    ...actual,
    useState: (initial) => {
      const cell = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      const set = (next) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
      };
      return [cell.value, set];
    },
    useRef: (initial) => slot(() => ({ current: initial })),
    useId: () => slot((index) => `id-${index}`),
    useEffect: (effect) => {
      hooks.current.effects.push(effect);
    },
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => () => {} }));
vi.mock('@/lib/apiClient', () => ({ api: { patch: apiPatch, post: vi.fn() } }));

const { default: ColorSwatches } = await import('@/app/(app)/projects/ColorSwatches.jsx');
const { default: ProjectDrawer } = await import('@/app/(app)/projects/ProjectDrawer.jsx');
const { useModal } = await import('@/components/useModal');

const PLUM = '#9c3fb8';
const mounted = [];
let focused = null;

/** Every element under `node`, host and component; with `expand`, components' own output too. */
function walk(node, visit, expand) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit, expand));
  if (!isValidElement(node)) return undefined;
  visit(node);
  if (expand && typeof node.type === 'function') return walk(node.type(node.props), visit, expand);
  return walk(node.props.children, visit, expand);
}

/** A stand-in DOM node for an element's ref: it can be focused and can fire events. */
function fakeNode(element) {
  const node = new EventTarget();
  node.value = element.props.defaultValue ?? '';
  node.focus = () => {
    focused = node;
  };
  return node;
}

/** What React does after a render: object refs point at the nodes now on the page, or null. */
function attachRefs(instance) {
  const now = new Map();
  walk(
    instance.tree,
    (element) => {
      const { ref } = element.props;
      if (typeof element.type === 'string' && ref && typeof ref === 'object') {
        now.set(ref, instance.nodes.get(ref) ?? fakeNode(element));
      }
    },
    instance.expand,
  );
  for (const ref of instance.nodes.keys()) if (!now.has(ref)) ref.current = null;
  for (const [ref, node] of now) ref.current = node;
  instance.nodes = now;
}

/** Renders a component with the test's hooks; `render(changes)` renders it again. */
function mount(Component, props, { expand = false } = {}) {
  const instance = { slots: [], cleanups: [], nodes: new Map(), props, expand };
  instance.render = (changes = {}) => {
    Object.assign(instance.props, changes);
    Object.assign(instance, { index: 0, effects: [] });
    hooks.current = instance;
    try {
      instance.tree = Component(instance.props);
    } finally {
      hooks.current = null;
    }
    attachRefs(instance);
    instance.cleanups.forEach((cleanup) => cleanup?.());
    instance.cleanups = instance.effects.map((effect) => effect());
    return instance;
  };
  instance.unmount = () => instance.cleanups.forEach((cleanup) => cleanup?.());
  mounted.push(instance);
  return instance.render();
}

const find = (view, predicate) => {
  const found = [];
  walk(view.tree, (element) => predicate(element) && found.push(element), view.expand);
  return found;
};
const host = (predicate) => (element) => typeof element.type === 'string' && predicate(element);
const one = (view, predicate) => find(view, host(predicate))[0];
const named = (label) => (element) => element.props['aria-label'] === label;
/** The CSS module class names, without their hash ('_moreDot_ab12' -> moreDot). */
const classes = (element) =>
  element.props.className.split(' ').map((name) => name.replace(/^_(.+)_[0-9a-f]+$/, '$1'));

const swatches = (props = {}) =>
  mount(ColorSwatches, { value: 'green', onChange: vi.fn(), ...props }, { expand: true });
const moreButton = (view) => one(view, (element) => element.props['aria-controls']);
const panel = (view) => one(view, (element) => element.props.role === 'group');
const colourInput = (view) => one(view, (element) => element.props.type === 'color');
const errorLine = (view) => one(view, (element) => element.props.role === 'alert');
const checked = (view) =>
  find(
    view,
    host((element) => element.props.type === 'radio' && element.props.checked),
  );

function click(view, element) {
  element.props.onClick();
  return view.render();
}

/** "Any colour": the person picks in the browser's picker; `type` is the event it fires. */
function pickAnyColour(view, hex, type = 'change') {
  const input = colourInput(view).props.ref.current;
  input.value = hex;
  input.dispatchEvent(new Event(type));
  return view.render();
}

/** An open drawer's real Escape handling (useModal), listening on a stand-in document. */
function openDrawer() {
  const listeners = [];
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('window', { innerWidth: 1024 });
  vi.stubGlobal('document', {
    activeElement: null,
    body: { style: {} },
    documentElement: { clientWidth: 1024 },
    addEventListener: (type, listener) => type === 'keydown' && listeners.push(listener),
    removeEventListener: () => {},
  });
  const onClose = vi.fn();
  const panelNode = { querySelector: () => null, focus: () => {}, contains: () => true };
  mount(function DrawerStandIn() {
    useModal({ open: true, onClose, panelRef: { current: panelNode } });
    return null;
  }, {});
  return { onClose, listeners };
}

/**
 * A key as the browser delivers it in the drawer. The Drawer is a portal on document.body, and
 * React handles a portal's events on its container, so React's handler runs first and the
 * document's listeners hear the key only when it was not stopped.
 */
function press(key, reactHandler, documentListeners) {
  const event = {
    key,
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  reactHandler?.(event);
  if (!event.stopped) documentListeners.forEach((listener) => listener(event));
  return event;
}

afterEach(() => {
  mounted.splice(0).forEach((instance) => instance.unmount());
  vi.unstubAllGlobals();
  apiPatch.mockReset();
  focused = null;
});

describe('More colours', () => {
  it('opens the panel under the row and closes it from the button again', () => {
    const view = swatches();
    const button = moreButton(view);
    expect(button.props['aria-label']).toBe('More colours');
    expect(button.props['aria-expanded']).toBe(false);
    expect(renderToStaticMarkup(view.tree)).toContain('lucide-palette');
    expect(panel(view)).toBeUndefined();

    click(view, button);
    const open = panel(view);
    expect(moreButton(view).props['aria-expanded']).toBe(true);
    expect(moreButton(view).props['aria-controls']).toBe(open.props.id);
    const title = one(view, (element) => element.props.id === open.props['aria-labelledby']);
    expect(title.props.children).toBe('More colours');
    const buttons = find(
      view,
      host((element) => 'aria-pressed' in element.props),
    );
    expect(buttons.map((element) => element.props['aria-label'])).toEqual(
      MORE_COLORS.map((color) => color.label),
    );
    expect(buttons.every((element) => element.props['aria-pressed'] === false)).toBe(true);
    expect(colourInput(view).props['aria-label']).toBe('Any colour');
    expect(colourInput(view).props.defaultValue).toBe('#2f86d6');

    click(view, moreButton(view));
    expect(panel(view)).toBeUndefined();
    expect(moreButton(view).props['aria-expanded']).toBe(false);
  });

  it('applies a swatch at once, closes the panel and puts focus on the button', () => {
    const view = swatches();
    click(view, moreButton(view));
    click(view, one(view, named('Plum')));
    expect(view.props.onChange).toHaveBeenCalledWith(PLUM);
    expect(panel(view)).toBeUndefined();
    expect(focused).toBe(moreButton(view).props.ref.current);
  });

  it('closes the panel when a preset is picked', () => {
    const view = swatches();
    click(view, moreButton(view));
    one(view, named('Yellow')).props.onChange();
    view.render();
    expect(view.props.onChange).toHaveBeenCalledWith('yellow');
    expect(panel(view)).toBeUndefined();
  });

  it('shows a custom colour on the button, ringed, with its own name', () => {
    const view = swatches({ value: PLUM });
    const button = moreButton(view);
    expect(button.props['aria-label']).toBe('More colours, custom colour chosen');
    const dot = button.props.children;
    expect(classes(dot)).toEqual(['moreDot', 'custom']);
    expect(dot.props.style).toEqual({ '--project': PLUM });
    expect(renderToStaticMarkup(view.tree)).not.toContain('lucide-palette');
    expect(checked(view)).toEqual([]);

    click(view, button);
    expect(one(view, named('Plum')).props['aria-pressed']).toBe(true);
    expect(colourInput(view).props.defaultValue).toBe(PLUM);
  });

  it('keeps a preset and anything invalid off the button', () => {
    const yellow = swatches({ value: 'yellow' });
    expect(checked(yellow).map((element) => element.props.value)).toEqual(['yellow']);
    expect(moreButton(yellow).props['aria-label']).toBe('More colours');

    const bad = swatches({ value: 'red; background:url(x)' });
    const dot = moreButton(bad).props.children;
    expect(moreButton(bad).props['aria-label']).toBe('More colours');
    expect(classes(dot)).toEqual(['moreDot']);
    expect(dot.props.style).toEqual({});
    expect(checked(bad)).toEqual([]);
  });
});

describe('Any colour', () => {
  it('does not apply a colour that is too light and says why in the error line', () => {
    const view = swatches();
    click(view, moreButton(view));
    pickAnyColour(view, '#ffe680');
    expect(view.props.onChange).not.toHaveBeenCalled();
    expect(errorLine(view).props.children).toBe(COLOR_PROBLEM_MESSAGES.light);
    expect(colourInput(view).props['aria-describedby']).toBe(errorLine(view).props.id);
    expect(panel(view)).toBeDefined();
    expect(moreButton(view).props['aria-label']).toBe('More colours');

    pickAnyColour(view, '#20243f');
    expect(view.props.onChange).not.toHaveBeenCalled();
    expect(errorLine(view).props.children).toBe(COLOR_PROBLEM_MESSAGES.dark);
  });

  it('applies a colour that can be seen on change, not while dragging, and stays open', () => {
    const view = swatches();
    click(view, moreButton(view));
    pickAnyColour(view, '#ffe680');
    pickAnyColour(view, '#c0399a', 'input');
    expect(view.props.onChange).not.toHaveBeenCalled();

    pickAnyColour(view, '#c0399a');
    expect(view.props.onChange).toHaveBeenCalledWith('#c0399a');
    expect(errorLine(view)).toBeUndefined();
    expect(colourInput(view).props['aria-describedby']).toBeUndefined();
    expect(panel(view)).toBeDefined();
  });

  it("shows the API's message in the same line, and a colour's own problem over it", () => {
    const view = swatches({ error: 'Pick a colour label.' });
    expect(errorLine(view).props.children).toBe('Pick a colour label.');
    click(view, moreButton(view));
    pickAnyColour(view, '#ffe680');
    expect(errorLine(view).props.children).toBe(COLOR_PROBLEM_MESSAGES.light);
    click(view, moreButton(view));
    expect(errorLine(view).props.children).toBe('Pick a colour label.');
  });
});

describe('Escape', () => {
  it("closes only the panel: the drawer's Escape listener never closes the drawer", () => {
    const drawer = openDrawer();
    const view = swatches();
    click(view, moreButton(view));

    const other = press('Enter', panel(view).props.onKeyDown, drawer.listeners);
    expect(other.stopped).toBe(false);
    expect(panel(view)).toBeDefined();

    const event = press('Escape', panel(view).props.onKeyDown, drawer.listeners);
    view.render();
    expect(event.stopped).toBe(true);
    expect(drawer.onClose).not.toHaveBeenCalled();
    expect(panel(view)).toBeUndefined();
    expect(focused).toBe(moreButton(view).props.ref.current);
    // Even if the document heard it (outside a portal), useModal skips an Escape already handled.
    drawer.listeners.forEach((listener) => listener(event));
    expect(drawer.onClose).not.toHaveBeenCalled();
  });

  it('closes the drawer as before when pressed anywhere else in it', () => {
    const drawer = openDrawer();
    press('Escape', undefined, drawer.listeners);
    expect(drawer.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the drawer's Colour label", () => {
  const PROJECT = {
    id: 5,
    name: 'Pine Tree Lane',
    clientName: 'Pine Tree Lane',
    pmId: 7,
    pmName: 'Riya Kapoor',
    members: [],
    status: 'active',
    color: 'green',
    isUrgent: false,
    urgentNote: null,
  };
  const drawer = () =>
    mount(ProjectDrawer, {
      mode: 'edit',
      project: PROJECT,
      managers: [{ id: 7, name: 'Riya Kapoor' }],
      people: [],
      viewer: { id: 7 },
      onClose: vi.fn(),
    });
  const swatchesIn = (view) => find(view, (element) => element.type === ColorSwatches)[0];
  const submit = async (view) => {
    await view.tree.props.onSubmit({ preventDefault: () => {} });
    return view.render();
  };

  it('is a group labelled Colour label around the swatches', () => {
    const view = drawer();
    const group = one(
      view,
      (element) => element.props['aria-labelledby'] === 'project-color-label',
    );
    expect(group.props.role).toBe('group');
    expect(one(view, (element) => element.props.id === 'project-color-label').props.children).toBe(
      'Colour label',
    );
    expect(find({ tree: group }, (element) => element.type === ColorSwatches)).toHaveLength(1);
    expect(swatchesIn(view).props.value).toBe('green');
  });

  it('sends the chosen colour', async () => {
    const view = drawer();
    swatchesIn(view).props.onChange(PLUM);
    view.render();
    expect(swatchesIn(view).props.value).toBe(PLUM);
    apiPatch.mockResolvedValueOnce({ data: {} });
    await submit(view);
    expect(apiPatch).toHaveBeenCalledWith(
      '/api/projects/5',
      expect.objectContaining({ color: PLUM }),
    );
  });

  it("shows the API's error for the colour in its line, not as a form error", async () => {
    const message =
      'This colour needs the latest database update. Pick one of the first six for now.';
    const view = drawer();
    swatchesIn(view).props.onChange(PLUM);
    view.render();
    apiPatch.mockRejectedValueOnce(
      Object.assign(new Error('Check the form.'), {
        code: 'VALIDATION_FAILED',
        status: 400,
        fields: { color: message },
      }),
    );
    await submit(view);
    expect(swatchesIn(view).props.error).toBe(message);
    expect(find(view, (element) => element.props.children === 'Check the form.')).toEqual([]);

    swatchesIn(view).props.onChange('yellow');
    view.render();
    expect(swatchesIn(view).props.error).toBeUndefined();
  });
});
