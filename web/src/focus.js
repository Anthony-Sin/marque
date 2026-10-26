import { useEffect, useRef } from 'react';

// Focusable elements inside an overlay — the same set browsers tab through.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  // <video controls> is a single tabbable unit (UA shadow-DOM controls) — trapped
  // overlays (editor, card zoom) render motion previews; Tab must not skip them.
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Open overlays push onto this stack — only the TOPMOST one owns the Tab trap,
// so a drawer over a modal doesn't fight the modal for the same keystroke.
// globalThis: an HMR re-eval of this module would otherwise hand new overlays
// a fresh stack while mounted ones still hold the old reference.
const stack = (globalThis.__marqueOverlayStack ??= []);

// Esc layering: a trapped overlay should only swallow Escape while it is the
// topmost stack entry — otherwise two co-open overlays peel off one press.
export const isTopOverlay = (root) => !!root && stack[stack.length - 1] === root;

// Non-trapped layers (the promote fold, dropdown menus) never join the stack —
// they defer their own Escape to whatever IS on it, so a lightbox/editor opened
// above them peels alone instead of sharing the keypress.
export const anyOverlayOpen = () => stack.length > 0;

// Focus discipline for overlays (modals, drawers, lightboxes, the palette):
// on open, stash the trigger and move focus inside (an explicit
// [data-autofocus] wins, else the first focusable child — often the close
// button); while open, Tab/Shift-Tab wrap between the first and last
// focusable child (soft trap — nothing keeps focus from leaving via mouse);
// on close, return focus to whatever opened it.
export function useOverlayFocus(ref, active = true) {
  const trigger = useRef(null);
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(root);

    const items = () => [...root.querySelectorAll(FOCUSABLE)]
      // tabIndex<0 rows (e.g. ⌘K options) match FOCUSABLE but the browser skips
      // them on Tab — including them would let focus fall out of the dialog.
      .filter((n) => n.tabIndex >= 0 && !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length));

    const target = root.querySelector('[data-autofocus]') || items()[0];
    target?.focus({ preventScroll: true });

    const onKey = (e) => {
      if (e.key !== 'Tab' || stack[stack.length - 1] !== root) return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const head = list[0], tail = list[list.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey ? (cur === head || !root.contains(cur)) : (cur === tail || !root.contains(cur))) {
        e.preventDefault();
        (e.shiftKey ? tail : head).focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(root);
      if (i >= 0) stack.splice(i, 1);
      const t = trigger.current;
      trigger.current = null;
      // restore only if the opener is still on the page — a deleted card's
      // button is gone, and yanking focus onto body helps nobody
      if (t && document.contains(t)) t.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
