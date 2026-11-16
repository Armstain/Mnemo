import { nfc } from '@/utils/text';

export interface LanguagePack {
  owns: (token: string) => boolean;
  stem: (token: string) => string;
  root?: (token: string) => string | undefined;
  common: string;
  asking: string;
}

// Bangla words carry their endings ("ট্যুরের", "ঢাকায়", "বইগুলো"); without
// them "ট্যুর" finds "ট্যুরের". Longest first.
const BANGLA_ENDINGS = ['গুলোর', 'গুলো', 'গুলি', 'দের', 'েরা', 'ের', 'এর', 'য়ের', 'কে', 'তে', 'টা', 'টি', 'টার', 'য়', 'র', 'ে']
  .map((e) => e.normalize('NFC'))
  .sort((a, b) => b.length - a.length);

function stripBanglaEnding(token: string): string {
  for (const ending of BANGLA_ENDINGS) {
    if (token.length > ending.length + 1 && token.endsWith(ending)) return token.slice(0, -ending.length);
  }
  return token;
}

const bangla: LanguagePack = {
  owns: (token) => /[\u0980-\u09FF]/.test(token),
  // Twice, so a word and its forms land on the same key: "ডাক্তার" loses
  // its last "র" (it reads like "মামার"), so "ডাক্তারকে" and "ডাক্তারের"
  // must lose it too, not stop at "ডাক্তার". A key, not a word.
  stem: (token) => stripBanglaEnding(stripBanglaEnding(token)),
  common:
    'ami amar tumi ache ase gese hobe korte korbo kore kal aj ajke ' +
    'আমি আমার আজ কাল আজকে হবে করতে করবো করে আছে গেছে টাকা এবং আর',
  asking: 'bolechi bolechilam bolsi likhechi likhechilam niye somporke ki kobe koto kothay keno',
};

const english: LanguagePack = {
  owns: (token) => /^[a-z0-9\u00c0-\u024f]+$/.test(token),
  // English plurals: "tickets" finds "ticket".
  stem: (token) => (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token),
  root: (term) => {
    if (!/^[a-z]+$/.test(term) || term.length < 5) return undefined;
    const root = term.replace(/(ing|ed|er|ery|ion|ions|ies|es|ly|y|e)$/, '');
    return root.length >= 4 ? root : undefined;
  },
  common:
    'the and for with this that from have has had was were are will would should could about into over just ' +
    'need today tomorrow yesterday then also some more very really what when where which who why how note ' +
    'taka spent paid got went did done make made take took call called get buy',
  asking: 'said say says tell told mention mentioned wrote write noted anything something everything thing things',
};

export const PACKS: LanguagePack[] = [bangla, english];

const wordsOf = (lists: string[]) => new Set(lists.flatMap((l) => l.split(' ')).filter(Boolean).map(nfc));

export const COMMON_WORDS = wordsOf(PACKS.map((p) => p.common));
export const ASKING_WORDS = wordsOf(PACKS.map((p) => p.asking));

export function stemOf(token: string): string {
  const pack = PACKS.find((p) => p.owns(token));
  return pack ? pack.stem(token) : token;
}

const GENERIC_ROOT_MIN = 6;
const GENERIC_ROOT_DROP = 2;

export function rootOf(term: string): string | undefined {
  const pack = PACKS.find((p) => p.owns(term));
  if (pack) return pack.root?.(term);
  const letters = [...term];
  return letters.length >= GENERIC_ROOT_MIN ? letters.slice(0, -GENERIC_ROOT_DROP).join('') : undefined;
}
