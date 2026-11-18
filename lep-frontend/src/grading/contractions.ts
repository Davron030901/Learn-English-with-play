/**
 * docs/09 §5 rule 5: contracted and full forms are accepted interchangeably (I'm / I am)
 * unless contraction is the target — which the item says by leaving `contraction` out of its
 * `normalise` list. Only the forms below expand; a possessive ('Aziz's book') never does.
 * Ambiguous forms expand to every reading (he's → he is / he has).
 */
const SIMPLE: Record<string, string[]> = {
  "i'm": ['i am'],
  "you're": ['you are'],
  "we're": ['we are'],
  "they're": ['they are'],
  "who're": ['who are'],
  "what're": ['what are'],
  "he's": ['he is', 'he has'],
  "she's": ['she is', 'she has'],
  "it's": ['it is', 'it has'],
  "that's": ['that is', 'that has'],
  "there's": ['there is', 'there has'],
  "here's": ['here is'],
  "what's": ['what is', 'what has'],
  "where's": ['where is', 'where has'],
  "who's": ['who is', 'who has'],
  "how's": ['how is', 'how has'],
  "when's": ['when is', 'when has'],
  "why's": ['why is'],
  "let's": ['let us'],
  "i've": ['i have'],
  "you've": ['you have'],
  "we've": ['we have'],
  "they've": ['they have'],
  "who've": ['who have'],
  "would've": ['would have'],
  "could've": ['could have'],
  "should've": ['should have'],
  "might've": ['might have'],
  "must've": ['must have'],
  "i'll": ['i will'],
  "you'll": ['you will'],
  "he'll": ['he will'],
  "she'll": ['she will'],
  "it'll": ['it will'],
  "we'll": ['we will'],
  "they'll": ['they will'],
  "that'll": ['that will'],
  "there'll": ['there will'],
  "who'll": ['who will'],
  "i'd": ['i would', 'i had'],
  "you'd": ['you would', 'you had'],
  "he'd": ['he would', 'he had'],
  "she'd": ['she would', 'she had'],
  "it'd": ['it would', 'it had'],
  "we'd": ['we would', 'we had'],
  "they'd": ['they would', 'they had'],
  "who'd": ['who would', 'who had'],
  "that'd": ['that would', 'that had'],
  "isn't": ['is not'],
  "aren't": ['are not'],
  "wasn't": ['was not'],
  "weren't": ['were not'],
  "don't": ['do not'],
  "doesn't": ['does not'],
  "didn't": ['did not'],
  "haven't": ['have not'],
  "hasn't": ['has not'],
  "hadn't": ['had not'],
  "won't": ['will not'],
  "wouldn't": ['would not'],
  "shan't": ['shall not'],
  "shouldn't": ['should not'],
  "can't": ['can not'],
  cannot: ['can not'],
  "couldn't": ['could not'],
  "mustn't": ['must not'],
  "needn't": ['need not'],
  "mightn't": ['might not'],
  "daren't": ['dare not'],
  "oughtn't": ['ought not'],
};

const MAX_VARIANTS = 32;

/**
 * Expands every contraction in a whitespace-tokenised, apostrophe-folded string. Returns all
 * readings (capped), each as a plain string. Case is preserved outside the expanded words so the
 * `case` rule (applied next) still decides whether case matters.
 */
export function expandContractions(text: string): string[] {
  const tokens = text.split(' ');
  let variants: string[][] = [[]];
  for (const token of tokens) {
    const m = token.match(/^([^A-Za-z']*)([A-Za-z']+)([^A-Za-z']*)$/);
    const word = m?.[2]?.toLowerCase();
    const readings = word ? SIMPLE[word] : undefined;
    if (!m || !readings) {
      variants = variants.map((v) => [...v, token]);
      continue;
    }
    const [, lead = '', core = '', trail = ''] = m;
    const capitalised = /^[A-Z]/.test(core);
    const next: string[][] = [];
    for (const v of variants) {
      for (const r of readings) {
        const cased = capitalised ? r.charAt(0).toUpperCase() + r.slice(1) : r;
        next.push([...v, `${lead}${cased}${trail}`]);
        if (next.length >= MAX_VARIANTS) break;
      }
      if (next.length >= MAX_VARIANTS) break;
    }
    variants = next;
  }
  return variants.map((v) => v.join(' '));
}
