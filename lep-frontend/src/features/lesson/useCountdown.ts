import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A calm 1-second countdown; `onExpire` fires once when it reaches zero. `resetKey` restarts it
 * (the runner passes the step index, so two items with the same limit each get the full time).
 * Not running = paused: the clock stops while the feedback sheet is open.
 *
 * The remaining time is stored *with* the key it belongs to, so a new item can never inherit the
 * previous item's zero and expire the moment it appears.
 */
export function useCountdown(seconds: number | null, running: boolean, onExpire: () => void, resetKey: string | number = 0): number | null {
  const key = `${String(resetKey)}:${String(seconds)}`;
  const [state, setState] = useState<{ key: string; left: number | null }>({ key, left: seconds });
  const firedFor = useRef<string | null>(null);
  const expire = useRef(onExpire);
  useLayoutEffect(() => {
    expire.current = onExpire;
  });

  const left = state.key === key ? state.left : seconds;

  useEffect(() => {
    if (left === null || !running) return;
    if (left <= 0) {
      if (firedFor.current !== key) {
        firedFor.current = key;
        expire.current();
      }
      return;
    }
    const id = setTimeout(() => setState({ key, left: left - 1 }), 1000);
    return () => clearTimeout(id);
  }, [left, running, key]);

  return left;
}
