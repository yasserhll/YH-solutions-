import { useEffect, useState } from 'react';

const NARROW = '(max-width: 767px)';
const TOUCH_ONLY = '(pointer: coarse) and (hover: none)';

/**
 * A real phone, whatever width the page is laid out at. The window width
 * alone is not enough (seen in the field): a phone in "Version pour
 * ordinateur" / "Site pour ordinateur" mode, a large phone in landscape, or a
 * browser zoomed out lays the page out at 980 px+, which used to show the PC
 * screens. The physical screen (`screen.width/height`, unchanged by those
 * modes) and a touch-only pointer still say "phone".
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile) return true;
  if (/Android.+Mobile|iPhone|iPod|Windows Phone|IEMobile|Opera Mini|Mobi/i.test(nav.userAgent)) return true;
  const shortSide = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0);
  const touchOnly = !!window.matchMedia?.(TOUCH_ONLY).matches || (navigator.maxTouchPoints > 1 && !window.matchMedia?.('(hover: hover)').matches);
  return touchOnly && shortSide > 0 && shortSide < 768;
}

function detect(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.matchMedia?.(NARROW).matches || isMobileDevice();
}

/** True on a phone (narrow window OR a real phone device), kept in sync on rotation / resize. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(detect);

  useEffect(() => {
    const update = () => setPhone(detect());
    update();
    const queries = [NARROW, TOUCH_ONLY].map((q) => window.matchMedia?.(q)).filter(Boolean) as MediaQueryList[];
    queries.forEach((m) => m.addEventListener('change', update));
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      queries.forEach((m) => m.removeEventListener('change', update));
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return phone;
}
