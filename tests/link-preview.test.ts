import { describe, expect, it } from 'vitest';
import { decodeEntities, parsePreview } from '@/lib/link-preview';

describe('link previews', () => {
  it('reads Open Graph tags in either order', () => {
    const html = `<title>Fallback &amp; title</title><meta content="The Real Title &#8211; Blog" property="og:title">
      <meta property="og:site_name" content="Example"><meta name="description" content="A   page about &quot;things&quot;.">
      <meta property="og:image" content="/img/cover.jpg">`;
    expect(parsePreview(html, 'https://example.com/post/1')).toEqual({
      title: 'The Real Title – Blog',
      site: 'Example',
      description: 'A page about "things".',
      imageUrl: 'https://example.com/img/cover.jpg',
    });
    expect(parsePreview('<title>Only &lt;this&gt;</title>', 'https://x.org').title).toBe('Only <this>');
    expect(decodeEntities('&#2453;')).toBe('ক');
  });
});
