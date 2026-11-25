import { useEffect, useRef } from 'react';

/**
 * The phone's Back button (Android back button / gesture, iOS swipe) closes
 * the window that is open (a form, a modal, the menu, the scanner) instead of
 * leaving the page — user's rule: Back must never throw the user out of the
 * app or back to the login page.
 *
 * While `open`, one extra history entry (same URL, same router state) is
 * pushed; Back pops it and we call `onClose`. Closing by the UI removes that
 * entry again (history.back()). Stacked windows close one at a time, top first.
 */
const stack: number[] = [];
let seq = 0;

export function useBackClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = ++seq;
    let pushed = false;
    let poppedByBack = false;

    const onPop = () => {
      if (!pushed || stack[stack.length - 1] !== id) return; // only the top window
      if ((window.history.state as { __overlay?: number } | null)?.__overlay === id) return;
      stack.pop();
      poppedByBack = true;
      closeRef.current();
    };

    // Deferred so React StrictMode's mount → unmount → mount (dev) never pushes twice.
    const timer = window.setTimeout(() => {
      window.history.pushState({ ...(window.history.state ?? {}), __overlay: id }, '');
      stack.push(id);
      pushed = true;
      window.addEventListener('popstate', onPop);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', onPop);
      if (!pushed || poppedByBack) return;
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      // Closed by the UI: drop our entry, unless a navigation already moved past it.
      if ((window.history.state as { __overlay?: number } | null)?.__overlay === id) window.history.back();
    };
  }, [open]);
}
