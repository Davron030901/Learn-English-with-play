/**
 * Pseudo-locales for layout testing (DECISIONS §8.1 A14): every string is accented and made
 * ~35 % longer so clipping shows, and the RTL variant is wrapped in right-to-left marks with the
 * layout direction flipped. ICU placeholders and plural syntax are left intact.
 */
const MAP: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ď',
  e: 'é',
  f: 'ƒ',
  g: 'ğ',
  h: 'ħ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ľ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ü',
  w: 'ŵ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ď',
  E: 'É',
  G: 'Ğ',
  H: 'Ħ',
  I: 'Í',
  L: 'Ľ',
  N: 'Ñ',
  O: 'Ö',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ü',
  Y: 'Ý',
  Z: 'Ž',
};

/**
 * Accents the text of an ICU message and nothing else: an argument's name, its type and the
 * keywords between plural or select branches (`one`, `other`, `=0`) are syntax and stay as they
 * are; each branch is a message again, where `#` (the number) stays too.
 */
function message(s: string, i: number, inPlural: boolean, nested: boolean): [string, number] {
  let out = '';
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === '}' && nested) return [out, i];
    if (ch === '{') {
      const [arg, j] = argument(s, i);
      out += arg;
      i = j;
      continue;
    }
    out += inPlural && ch === '#' ? ch : (MAP[ch] ?? ch);
    i += 1;
  }
  return [out, i];
}

function argument(s: string, start: number): [string, number] {
  let i = start + 1;
  let out = '{';
  const syntax = () => {
    let run = '';
    while (i < s.length && s[i] !== '{' && s[i] !== '}') {
      run += s[i];
      i += 1;
    }
    return run;
  };
  const header = syntax();
  out += header;
  const plural = /,\s*(?:plural|selectordinal)\b/.test(header);
  while (s[i] === '{') {
    const [body, j] = message(s, i + 1, plural, true);
    out += `{${body}}`;
    i = j + 1;
    out += syntax();
  }
  if (s[i] === '}') {
    out += '}';
    i += 1;
  }
  return [out, i];
}

function transformText(s: string): string {
  return message(s, 0, false, false)[0];
}

function pad(s: string): string {
  const extra = Math.max(2, Math.round(s.length * 0.35));
  return `${s}${' ~'.repeat(Math.ceil(extra / 2))}`;
}

type Tree = { [k: string]: string | Tree };

export function pseudoize(tree: Tree, rtl: boolean): Tree {
  const out: Tree = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') {
      const t = pad(transformText(v));
      out[k] = rtl ? `‮${t}‬` : `[${t}]`;
    } else {
      out[k] = pseudoize(v, rtl);
    }
  }
  return out;
}
