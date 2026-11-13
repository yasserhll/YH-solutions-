import { useEffect, useState } from 'react';

const QUERY = '(max-width: 767px)';

/** True on a phone-sized screen (below Tailwind's `md`), kept in sync on rotation / resize. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia?.(QUERY);
    if (!media) return;
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return phone;
}
