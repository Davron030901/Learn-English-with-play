/**
 * Damerau–Levenshtein (optimal string alignment) distance ≤ 1: one insertion, deletion,
 * substitution, or transposition of two adjacent characters (docs/09 §5 rule 7).
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diffs: number[] = [];
    for (let i = 0; i < la; i += 1) {
      if (a[i] !== b[i]) {
        diffs.push(i);
        if (diffs.length > 2) return false;
      }
    }
    if (diffs.length === 1) return true;
    if (diffs.length === 2) {
      const [i, j] = diffs as [number, number];
      return j === i + 1 && a[i] === b[j] && a[j] === b[i];
    }
    return false;
  }
  // One insertion/deletion: walk the longer string skipping one character.
  const [long, short] = la > lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < long.length && j < short.length) {
    if (long[i] === short[j]) {
      i += 1;
      j += 1;
    } else if (!skipped) {
      skipped = true;
      i += 1;
    } else {
      return false;
    }
  }
  return true;
}

/** Full OSA distance, for tests and diagnostics. */
export function osaDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = d[i] as number[];
      const prev = d[i - 1] as number[];
      let v = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, ((d[i - 2] as number[])[j - 2] as number) + 1);
      }
      row[j] = v;
    }
  }
  return (d[a.length] as number[])[b.length] as number;
}
