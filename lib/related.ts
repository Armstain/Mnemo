import { idf, telling, tokenize } from '@/lib/bm25';
import { isCurrency, metricKey } from '@/lib/measures';
import { dot } from '@/lib/vector-math';
import { nfc } from '@/utils/text';
import type { Entry, MnemoItem, Place } from '@/types/mnemo';

// "Related threads", worked out on the phone. No request is made: every
// sign below is read from what's already stored, so it works offline and
// without a key. Stored vectors (search by meaning) add to it when they're
// there, and are never needed.
//
// The signs, strongest first:
//   - a note in one thread was suggested for the other (filing)
//   - both save the same link, or pages from the same uncommon site
//   - both mention the same uncommon words; names and title words count more
//   - both carry the same uncommon tag
//   - both have a reminder at the same saved place
//   - both track the same measure (weight, pages, a spending group)
//   - both keep being added to on the same days
// "Uncommon" is judged against this person's own notes: a word or tag that
// most of their threads carry says nothing about any two of them.

export interface RelatedThread {
  item: MnemoItem;
  /** One line saying why, e.g. "Both mention “Rahman” and “visa”". */
  reason: string;
}

const WEIGHT = { filing: 0.9, links: 0.9, words: 1, tags: 0.7, place: 0.6, measures: 0.4, together: 0.5, meaning: 0.7 };

/** A thread's words are judged on its most telling few, so a long thread isn't penalised for everything else it holds. */
const PROFILE_TERMS = 40;
const TITLE_BOOST = 1.6;
const NAME_BOOST = 1.6;
/** In a library this big, a word or tag on more than this share of threads is too common to connect two of them. */
const WIDESPREAD_FROM = 8;
const WIDESPREAD_SHARE = 0.4;
/** Below this, shared words are chance. */
const MIN_WORDS = 0.1;
const MIN_TOTAL = 0.1;

// Stored vectors, when there are any. Note-to-note similarity is noisy for
// short notes (a related pair measured 0.60, an unrelated one 0.61), so it
// only adds to other signs, and stands alone only when very high.
const MEANING_FLOOR = 0.62;
const MEANING_ALONE = 0.8;

/** Shared days needed before "added to on the same days" means anything: one sitting often holds unrelated thoughts. */
const TOGETHER_DAYS = 3;

// Capitalised mid-sentence, but not a name of anything.
const NOT_NAMES = new Set(
  (
    'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august ' +
    'september october november december jan feb mar apr jun jul aug sep sept oct nov dec'
  ).split(' '),
);

// Sites so widely used that two threads linking to them says nothing.
const COMMON_SITES = new Set(
  (
    'google.com youtube.com youtu.be facebook.com fb.com instagram.com twitter.com x.com wikipedia.org amazon.com ' +
    'linkedin.com reddit.com github.com medium.com whatsapp.com wa.me t.co bit.ly maps.app.goo.gl goo.gl tiktok.com'
  ).split(' '),
);

interface Term {
  surface: string;
  count: number;
  inTitle: boolean;
  /** Written with a capital in the middle of a sentence: a person, a place, a shop. */
  name: boolean;
}

interface Profile {
  terms: Map<string, Term>;
  tags: Map<string, string>;
  links: Set<string>;
  sites: Set<string>;
}

const WORD = /[A-Za-z0-9À-ɏঀ-৿]+/g;

function readTerms(text: string, inTitle: boolean, into: Map<string, Term>): void {
  const normal = nfc(text);
  let end = 0;
  let first = true;
  for (const m of normal.matchAll(WORD)) {
    const raw = m[0];
    const gap = normal.slice(end, m.index);
    end = (m.index ?? 0) + raw.length;
    // Anything but spaces, commas and quotes before it starts a new sentence or line.
    const startsSentence = first || !/^[\s,'"“”‘’(&/]*$/.test(gap) || gap.includes('\n');
    first = false;
    const key = tokenize(raw)[0];
    if (!key || telling([key]).size === 0 || NOT_NAMES.has(key)) continue;
    // Titles are capitalised anyway, so a capital there proves nothing.
    const name = !inTitle && !startsSentence && /^[A-Z][a-zà-ɏ]{2,}$/.test(raw);
    const term = into.get(key);
    if (term) {
      term.count += 1;
      term.inTitle ||= inTitle;
      term.name ||= name;
      // The plainest form reads best ("ticket", not "tickets"); a name keeps its capital.
      if (name && !/^[A-Z]/.test(term.surface)) term.surface = raw;
      else if (raw.length < term.surface.length && !/^[A-Z]/.test(term.surface)) term.surface = raw.toLowerCase();
    } else {
      into.set(key, { surface: name ? raw : raw.toLowerCase(), count: 1, inTitle, name });
    }
  }
}

/** A link without what varies between two copies of it (scheme, www, tracking, a trailing slash). */
export function linkKey(url: string): { key: string; site: string } | null {
  const m = url.trim().match(/^(?:https?:\/\/)?(?:www\.|m\.)?([^/?#\s]+)([^?#\s]*)(\?[^#\s]*)?/i);
  if (!m || !m[1].includes('.')) return null;
  const site = m[1].toLowerCase();
  const path = (m[2] ?? '').replace(/\/+$/, '');
  const query = (m[3] ?? '')
    .slice(1)
    .split('&')
    .filter((p) => p && !/^(utm_|fbclid|gclid|ref=|si=|igshid)/i.test(p))
    .join('&');
  return { key: `${site}${path}${query ? `?${query}` : ''}`, site };
}

const profileCache = new Map<string, { updatedAt: number; profile: Profile }>();

function profileOf(item: MnemoItem): Profile {
  const cached = profileCache.get(item.id);
  if (cached && cached.updatedAt === item.updatedAt) return cached.profile;
  const terms = new Map<string, Term>();
  readTerms(item.title, true, terms);
  // Links are compared as links; their letters aren't words.
  readTerms(`${item.content}\n${item.nextStep ?? ''}\n${item.whereLeftOff ?? ''}`.replace(/https?:\/\/\S+/g, ' '), false, terms);
  const tags = new Map<string, string>();
  for (const tag of item.tags ?? []) if (tag.trim()) tags.set(nfc(tag.trim().toLowerCase()), tag.trim());
  const links = new Set<string>();
  const sites = new Set<string>();
  const urls = [...(item.links ?? []), ...(item.content.match(/https?:\/\/\S+/g) ?? [])];
  for (const url of urls) {
    const link = linkKey(url);
    if (!link) continue;
    links.add(link.key);
    sites.add(link.site);
  }
  const profile = { terms, tags, links, sites };
  profileCache.set(item.id, { updatedAt: item.updatedAt, profile });
  return profile;
}

/** What a thread's entries add: what it measures, the days it was added to, and where its notes were suggested to go. */
interface History {
  measures: Map<string, string>;
  days: Set<number>;
  suggestedTo: Set<string>;
}

const historyCache = new WeakMap<Entry[], Map<string, History>>();

function historiesOf(entries: Entry[]): Map<string, History> {
  const cached = historyCache.get(entries);
  if (cached) return cached;
  const out = new Map<string, History>();
  for (const entry of entries) {
    let h = out.get(entry.threadId);
    if (!h) out.set(entry.threadId, (h = { measures: new Map(), days: new Set(), suggestedTo: new Set() }));
    const d = new Date(entry.createdAt);
    h.days.add(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
    if (entry.filing.by === 'suggested') h.suggestedTo.add(entry.filing.threadId);
    for (const block of entry.blocks) {
      if (block.kind !== 'measures') continue;
      for (const m of block.items) {
        // Money spent is in half the threads; what it was spent on (its group) is what connects two.
        if (!isCurrency(m.unit)) h.measures.set(`metric:${metricKey(m.metric)}`, m.metric.trim().toLowerCase());
        if (m.group?.trim()) h.measures.set(`group:${metricKey(m.group)}`, m.group.trim().toLowerCase());
      }
    }
  }
  historyCache.set(entries, out);
  return out;
}

function quote(words: string[]): string {
  return words.map((w) => `“${w}”`).join(' and ');
}

export interface RelatedOptions {
  /** Every entry of every thread; without them only words, tags, links and places are read. */
  entries?: Entry[];
  /** Saved places, to name the one two threads share. */
  places?: Place[];
  /** Stored vectors by thread id, if search by meaning has made any. */
  vectors?: Map<string, Float32Array>;
  limit?: number;
}

export function relatedLocally(self: MnemoItem, items: MnemoItem[], options: RelatedOptions = {}): RelatedThread[] {
  const { places = [], vectors, limit = 3 } = options;
  const open = items.filter((i) => i.id !== self.id && i.status !== 'archived' && !i.pending);
  if (open.length === 0) return [];
  const library = [self, ...open];
  const n = library.length;

  // How many threads carry each word, tag and site.
  const wordIn = new Map<string, number>();
  const tagIn = new Map<string, number>();
  const siteIn = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const item of library) {
    const p = profileOf(item);
    for (const key of p.terms.keys()) bump(wordIn, key);
    for (const key of p.tags.keys()) bump(tagIn, key);
    for (const site of p.sites) bump(siteIn, site);
  }
  const widespread = (count: number) => n >= WIDESPREAD_FROM && count / n > WIDESPREAD_SHARE;
  const rarity = (count: number) => idf(count, n);

  const weighed = new Map<string, { weights: Map<string, number>; norm: number }>();
  const weigh = (item: MnemoItem) => {
    const done = weighed.get(item.id);
    if (done) return done;
    const all: [string, number][] = [];
    for (const [key, term] of profileOf(item).terms) {
      const count = wordIn.get(key) ?? 1;
      if (widespread(count)) continue;
      all.push([key, rarity(count) * (1 + Math.log(term.count)) * (term.inTitle ? TITLE_BOOST : 1) * (term.name ? NAME_BOOST : 1)]);
    }
    const top = all.sort((a, b) => b[1] - a[1]).slice(0, PROFILE_TERMS);
    const made = { weights: new Map(top), norm: Math.sqrt(top.reduce((sum, [, w]) => sum + w * w, 0)) };
    weighed.set(item.id, made);
    return made;
  };

  const histories = options.entries ? historiesOf(options.entries) : new Map<string, History>();
  const mine = profileOf(self);
  const myWords = weigh(self);
  const myHistory = histories.get(self.id);
  const myVector = vectors?.get(self.id);
  const found: (RelatedThread & { score: number })[] = [];

  for (const item of open) {
    const theirs = profileOf(item);
    const theirHistory = histories.get(item.id);
    const signs: { score: number; reason: string }[] = [];

    // A note was suggested from one into the other.
    if (myHistory?.suggestedTo.has(item.id)) signs.push({ score: WEIGHT.filing, reason: 'A note here may belong there' });
    else if (theirHistory?.suggestedTo.has(self.id)) signs.push({ score: WEIGHT.filing, reason: 'Has a note that may belong here' });

    // The same link, or the same uncommon site.
    const sameLink = [...theirs.links].some((l) => mine.links.has(l));
    const sameSite = [...theirs.sites].find(
      (s) => mine.sites.has(s) && !COMMON_SITES.has(s) && !widespread(siteIn.get(s) ?? 0) && (siteIn.get(s) ?? 0) <= 3,
    );
    if (sameLink) signs.push({ score: WEIGHT.links, reason: 'Saves the same link' });
    else if (sameSite) signs.push({ score: WEIGHT.links * 0.45, reason: `Both link to ${sameSite}` });

    // Shared words.
    const theirWords = weigh(item);
    const shared: { key: string; weight: number }[] = [];
    let product = 0;
    for (const [key, w] of theirWords.weights) {
      const mineW = myWords.weights.get(key);
      if (mineW === undefined) continue;
      product += w * mineW;
      shared.push({ key, weight: w * mineW });
    }
    const overlap = product > 0 ? product / (myWords.norm * theirWords.norm) : 0;
    shared.sort((a, b) => b.weight - a.weight);
    // One shared word is enough only when it's a name or names a thread.
    const strong = shared.some(({ key }) => {
      const a = mine.terms.get(key)!;
      const b = theirs.terms.get(key)!;
      return a.name || b.name || a.inTitle || b.inTitle;
    });
    if (overlap >= MIN_WORDS && (shared.length >= 2 || strong)) {
      const shown = shared.slice(0, 2).map(({ key }) => {
        const a = mine.terms.get(key)!;
        const b = theirs.terms.get(key)!;
        return a.name || !b.name ? a.surface : b.surface;
      });
      signs.push({ score: WEIGHT.words * Math.min(1, overlap * 1.5), reason: `Both mention ${quote(shown)}` });
    }

    // Shared tags, each counted by how few threads carry it.
    let tagsShared = 0;
    let tagsAll = 0;
    const tagNames: [string, number][] = [];
    for (const key of new Set([...mine.tags.keys(), ...theirs.tags.keys()])) {
      const count = tagIn.get(key) ?? 1;
      if (widespread(count)) continue;
      const w = rarity(count);
      tagsAll += w;
      if (mine.tags.has(key) && theirs.tags.has(key)) {
        tagsShared += w;
        tagNames.push([mine.tags.get(key)!, w]);
      }
    }
    if (tagsShared > 0) {
      const names = tagNames.sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => `#${t}`);
      // Any shared tag is a reason someone gave on purpose, so it never counts for nothing.
      signs.push({ score: WEIGHT.tags * Math.max(0.3, tagsShared / tagsAll), reason: `Also tagged ${names.join(' ')}` });
    }

    // A reminder at the same saved place.
    if (self.place && item.place && self.place.placeId === item.place.placeId) {
      const place = places.find((p) => p.id === self.place!.placeId);
      signs.push({ score: WEIGHT.place, reason: place ? `Both for ${place.name}` : 'Both for the same place' });
    }

    // The same thing measured.
    if (myHistory && theirHistory) {
      const same = [...theirHistory.measures.keys()].filter((k) => myHistory.measures.has(k));
      if (same.length > 0) {
        signs.push({
          score: WEIGHT.measures * (same.length > 1 ? 1 : 0.6),
          reason: `Both track ${myHistory.measures.get(same[0])}`,
        });
      }

      // Added to on the same days, again and again; and not just because one of them is added to daily.
      let days = 0;
      for (const day of theirHistory.days) if (myHistory.days.has(day)) days += 1;
      const share = days / Math.max(1, Math.min(myHistory.days.size, theirHistory.days.size));
      const busiest = Math.max(myHistory.days.size, theirHistory.days.size);
      if (days >= TOGETHER_DAYS && share >= 0.5 && days / busiest >= 0.25) {
        signs.push({ score: WEIGHT.together * Math.min(1, days / 5) * share, reason: 'Often added to on the same days' });
      }
    }

    // Close in meaning, from vectors already stored.
    const theirVector = vectors?.get(item.id);
    let lift = 0;
    if (myVector && theirVector) {
      const similarity = dot(myVector, theirVector);
      if (similarity >= MEANING_ALONE) signs.push({ score: WEIGHT.meaning, reason: 'Very similar topic' });
      // Otherwise it adds weight to what's already there; too noisy to be a reason by itself.
      else if (similarity >= MEANING_FLOOR) lift = (WEIGHT.meaning * (similarity - MEANING_FLOOR)) / (MEANING_ALONE - MEANING_FLOOR);
    }

    if (signs.length === 0) continue;
    signs.sort((a, b) => b.score - a.score);
    let score = signs.reduce((sum, s) => sum + s.score, 0);
    if (score < MIN_TOTAL) continue;
    score += lift;
    // Same area of life: breaks ties, proves nothing.
    if (item.category === self.category && item.category !== 'general') score += 0.05;
    const second = signs[1] && signs[1].score >= signs[0].score * 0.5 ? signs[1].reason : null;
    found.push({
      item,
      score,
      reason: second ? `${signs[0].reason} · ${second.charAt(0).toLowerCase()}${second.slice(1)}` : signs[0].reason,
    });
  }

  return found
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .slice(0, limit)
    .map(({ item, reason }) => ({ item, reason }));
}
