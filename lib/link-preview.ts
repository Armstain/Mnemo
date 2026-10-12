import { Platform } from 'react-native';

// A saved link gets its page's own title, site name, description and
// picture, read by the phone from the page's meta tags. No AI involved;
// the only thing sent anywhere is the request for the page itself.

export interface LinkPreview {
  title?: string;
  site?: string;
  description?: string;
  imageUrl?: string;
}

const TIMEOUT_MS = 6000;
const MAX_HTML = 400_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function clean(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const flat = decodeEntities(text).replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Reads the preview fields out of a page's HTML. */
export function parsePreview(html: string, pageUrl: string): LinkPreview {
  const head = html.slice(0, MAX_HTML);
  const meta = (key: string): string | undefined => {
    // <meta property="og:title" content="…"> in either attribute order.
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i').exec(head);
    const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i').exec(head);
    return (a ?? b)?.[1];
  };
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1];
  let imageUrl = meta('og:image') ?? meta('twitter:image');
  if (imageUrl) {
    try {
      imageUrl = new URL(decodeEntities(imageUrl), pageUrl).toString();
    } catch {
      imageUrl = undefined;
    }
  }
  return {
    title: clean(meta('og:title') ?? meta('twitter:title') ?? titleTag, 140),
    site: clean(meta('og:site_name'), 60),
    description: clean(meta('og:description') ?? meta('description') ?? meta('twitter:description'), 240),
    imageUrl: imageUrl && /^https:\/\//.test(imageUrl) ? imageUrl : undefined,
  };
}

/** Fetches a page and reads its preview; null if it can't. */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  // Browsers block reading other sites' pages; the web build goes without.
  if (Platform.OS === 'web' || !/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/html' } });
    if (!response.ok || !/html/i.test(response.headers.get('content-type') ?? 'text/html')) return null;
    const preview = parsePreview(await response.text(), response.url || url);
    return preview.title || preview.description ? preview : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
