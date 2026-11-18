import { useEffect, useEffectEvent, useState } from 'react';

import { Txt, type TxtProps } from '@/design/Txt';

/**
 * A number that counts up to `value` over `durationMs` with an ease-out (docs/16 E01: 600 ms),
 * then stays. Reduced motion (or `animate` false) shows the final value at once. The text is
 * hidden from screen readers: the caller puts the final value in its accessible label, so a
 * reader never hears the intermediate numbers.
 */
export function CountUp({
  value,
  from = 0,
  durationMs = 600,
  animate = true,
  onDone,
  format = String,
  ...txt
}: {
  value: number;
  from?: number;
  durationMs?: number;
  animate?: boolean;
  onDone?: () => void;
  format?: (n: number) => string;
} & Omit<TxtProps, 'children'>) {
  const counting = animate && from !== value;
  // The last tick of a count: which target it reached, and the number on screen. A count that is
  // not running (or not yet ticked for this target) is derived during render instead.
  const [tick, setTick] = useState<{ target: number; from: number; shown: number } | null>(null);
  const shown = !counting ? value : tick && tick.target === value && tick.from === from ? tick.shown : from;
  const done = useEffectEvent(() => onDone?.());

  useEffect(() => {
    if (!counting) {
      done();
      return;
    }
    const started = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - started) / durationMs);
      const eased = 1 - (1 - p) ** 3;
      setTick({ target: value, from, shown: Math.round(from + (value - from) * eased) });
      if (p >= 1) {
        clearInterval(id);
        done();
      }
    }, 32);
    return () => clearInterval(id);
  }, [counting, value, from, durationMs]);

  return (
    <Txt {...txt} accessible={false} importantForAccessibility="no">
      {format(shown)}
    </Txt>
  );
}
