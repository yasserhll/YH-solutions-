import { useEffect, useRef } from 'react';

/**
 * The phone's Back button (Android back button / gesture, iOS swipe) closes
 * the window that is open (a form, a modal, the menu, the QR scanner) instead
 * of leaving the page — user's rule: Back never throws the user out of the
 * app or back to the login page.
 *
 * ONE manager for every window, holding at most ONE extra history entry (a
 * "guard", same URL + same router state) while at least one window is open:
 * - Back pops the guard → the TOP window is closed; if others stay open the
 *   guard is pushed again.
 * - Closing by the UI does NOT touch the history at once: the guard is only
 *   removed (history.back()) when no window is left open a moment later. So
 *   "scanner closes → bon form opens" in the same click never races with the
 *   history (that race used to close the freshly opened form, field bug
 *   2026-11-26), and nothing can pop the wrong entry.
 */
type Entry = { id: number; close: () => void; holdsUpdate: boolean };

const stack: Entry[] = [];
let seq = 0;
let guardId = 0; // id of OUR history entry while it is there, else 0
let removing = false; // a history.back() of ours is in flight
let syncTimer = 0;

const stateOf = () => window.history.state as { __guard?: number } | null;

function sync() {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    if (removing) return; // finished in onPop
    if (stack.length > 0 && !guardId) {
      guardId = ++seq;
      window.history.pushState({ ...(stateOf() ?? {}), __guard: guardId }, '');
    } else if (stack.length === 0 && guardId) {
      if (stateOf()?.__guard === guardId) {
        removing = true;
        window.history.back();
      } else {
        guardId = 0; // a navigation already replaced / moved past it
      }
    }
  }, 30);
}

function onPop() {
  if (removing) {
    // Our own history.back() landed.
    removing = false;
    guardId = 0;
    sync();
    return;
  }
  if (!guardId || stateOf()?.__guard === guardId) return;
  // The user pressed Back: the guard is gone, close the top window.
  guardId = 0;
  const top = stack[stack.length - 1];
  try {
    top?.close();
  } finally {
    sync(); // still a window open (stacked, or close refused) → guard again
  }
}

let listening = false;

/**
 * How many windows that may hold unsaved input (forms, modals, the scanner)
 * are open right now — the update banner never reloads under one. The menu
 * and the notifications panel don't count: the bell panel opens by itself on
 * the Dashboard, and counting it kept the banner waiting forever (2026-11-26).
 */
export function openWindowCount(): number {
  return stack.filter((e) => e.holdsUpdate).length;
}


/** `holdsUpdate: false` for a window with nothing to lose on reload (menu, notifications panel). */
export function useBackClose(open: boolean, onClose: () => void, { holdsUpdate = true }: { holdsUpdate?: boolean } = {}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    if (!listening) {
      window.addEventListener('popstate', onPop);
      listening = true;
    }
    const entry: Entry = { id: ++seq, close: () => closeRef.current(), holdsUpdate };
    stack.push(entry);
    sync();
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      sync();
    };
  }, [open, holdsUpdate]);
}
