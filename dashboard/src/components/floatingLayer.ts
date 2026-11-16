import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

// Popups (CustomSelect lists, the DateTimePicker panel) render in a portal on document.body with fixed
// positioning, so no `overflow: hidden` ancestor (a modal body, a table cell) clips them. Being outside the
// modal card, they also sit outside the modal's own keyboard handling, which listens for Escape and Tab in the
// capture phase on document. This module keeps a stack of open popups and answers those two keys for the top one
// first, from a capture listener on window (which runs before document's), so Escape closes the popup and not
// the dialog under it, and Tab stays inside a popup that wants it to.

interface Layer {
  onEscape: () => void;
  onTab?: (event: KeyboardEvent) => void;
}

const stack: Layer[] = [];

function onKeyDown(event: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === 'Escape' && !event.isComposing) {
    event.stopPropagation();
    event.preventDefault();
    top.onEscape();
  } else if (event.key === 'Tab' && top.onTab) {
    event.stopPropagation();
    top.onTab(event);
  }
}

/** Registers an open popup on top of the stack; the returned function removes it. */
export function pushLayer(layer: Layer): () => void {
  if (stack.length === 0) window.addEventListener('keydown', onKeyDown, true);
  stack.push(layer);
  return () => {
    const i = stack.lastIndexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) window.removeEventListener('keydown', onKeyDown, true);
  };
}

/** Keeps the popup registered while `open`; the handlers are read through a ref so they may change each render. */
export function useLayer(open: boolean, layer: Layer): void {
  const ref = useRef(layer);
  useEffect(() => {
    ref.current = layer;
  });
  useEffect(() => {
    if (!open) return undefined;
    return pushLayer({
      onEscape: () => ref.current.onEscape(),
      onTab: event => (ref.current.onTab ? ref.current.onTab(event) : undefined),
    });
  }, [open]);
}

// Every open popup that closes on outside interaction, in opening order. A popup opened from inside another (a
// select inside the date picker panel) sits above it, and a press in the upper one counts as inside the lower.
interface Dismissable {
  contains: (node: Node) => boolean;
  close: () => void;
}

const dismissStack: Dismissable[] = [];

/** The event name a dialog fires on document when it opens, so every open popup under it closes. */
export const DIALOG_OPEN_EVENT = 'zaplink:dialog-open';

/** Closes every open popup (a route change, a dialog opening). */
export function closeAllFloating(): void {
  for (const entry of [...dismissStack].reverse()) entry.close();
}

function insideFrom(entry: Dismissable, node: Node | null): boolean {
  if (!node) return false;
  const at = dismissStack.indexOf(entry);
  if (at < 0) return false;
  return dismissStack.slice(at).some(e => e.contains(node));
}

/**
 * Closes the popup on any interaction that leaves it:
 * - a press outside its elements (`refs`: the widget root and the portaled popup), seen on pointerdown and
 *   mousedown in the capture phase on document, so a button that stops propagation still closes it;
 * - focus moving outside it;
 * - a dialog opening ({@link DIALOG_OPEN_EVENT}) or {@link closeAllFloating} (a route change);
 * - a window resize, or a scroll that takes the anchor out of view.
 * A press or focus inside a popup opened later (a nested one) counts as inside.
 */
export function useOutsideClose(
  open: boolean,
  onOutside: () => void,
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
  anchorRef?: RefObject<HTMLElement | null>,
): void {
  const handler = useRef(onOutside);
  const refsRef = useRef(refs);
  const anchor = useRef(anchorRef);
  useEffect(() => {
    handler.current = onOutside;
    refsRef.current = refs;
    anchor.current = anchorRef;
  });
  useEffect(() => {
    if (!open) return undefined;
    let closed = false;
    const entry: Dismissable = {
      contains: node => refsRef.current.some(r => !!r.current && r.current.contains(node)),
      close: () => {
        if (closed) return;
        closed = true;
        handler.current();
      },
    };
    dismissStack.push(entry);
    const onDown = (event: Event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!insideFrom(entry, target)) entry.close();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      // Focus returning to the document itself is no move into another control.
      if (!target || target === document.body || target === document.documentElement) return;
      if (!insideFrom(entry, target)) entry.close();
    };
    const onResize = () => entry.close();
    const onScroll = (event: Event) => {
      const target = event.target instanceof Node ? event.target : null;
      // Scrolling the popup's own list is not a reason to close it.
      if (target && insideFrom(entry, target)) return;
      const el = anchor.current?.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) entry.close();
    };
    const onDialog = () => entry.close();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener(DIALOG_OPEN_EVENT, onDialog);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      closed = true;
      const i = dismissStack.indexOf(entry);
      if (i >= 0) dismissStack.splice(i, 1);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener(DIALOG_OPEN_EVENT, onDialog);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);
}

/**
 * Fixed-position style for a popup under its anchor, flipped above it when there is not room below and more
 * room above. Follows the anchor on scroll (any scroll container) and resize.
 */
export function useFloatingStyle(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  options: { gap?: number; maxHeight?: number; matchWidth?: boolean; minWidth?: number } = {},
): CSSProperties {
  const { gap = 4, maxHeight = 250, matchWidth = true, minWidth = 160 } = options;
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' });

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const floating = floatingRef.current;
    const natural = floating ? floating.scrollHeight : maxHeight;
    const wanted = Math.min(natural, maxHeight);
    const below = vh - rect.bottom - gap - 8;
    const above = rect.top - gap - 8;
    const up = below < wanted && above > below;
    const width = matchWidth ? Math.max(rect.width, minWidth) : undefined;
    const floatWidth = width ?? floating?.offsetWidth ?? 0;
    // Keep it on screen horizontally; RTL anchors are aligned on their right edge.
    const rtl = getComputedStyle(anchor).direction === 'rtl';
    let left = rtl ? rect.right - floatWidth : rect.left;
    left = Math.max(8, Math.min(left, vw - floatWidth - 8));
    setStyle({
      position: 'fixed',
      left,
      ...(up ? { bottom: vh - rect.top + gap } : { top: rect.bottom + gap }),
      ...(width !== undefined ? { width } : {}),
      maxHeight: Math.max(120, Math.min(maxHeight, up ? above : below)),
    });
  }, [anchorRef, floatingRef, gap, maxHeight, matchWidth, minWidth]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return style;
}

/** Visible, enabled tab stops inside `root`, in document order. */
export function tabStops(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(el => el.tabIndex >= 0);
}
