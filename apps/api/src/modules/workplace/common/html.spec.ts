import { describe, expect, it } from 'vitest';
import { excerptOf, htmlToText, imageFileIds, sanitizeHtml } from './html';

describe('rich-text sanitizer (notice / feed bodies)', () => {
  it('keeps the allowlist and normalises b/i/div/h1', () => {
    expect(sanitizeHtml('<h1>Title</h1><div><b>Bold</b> and <i>it</i></div><ul><li>one</li></ul>')).toBe('<h2>Title</h2><p><strong>Bold</strong> and <em>it</em></p><ul><li>one</li></ul>');
  });

  it('removes scripts, styles, iframes and event handlers', () => {
    const out = sanitizeHtml('<p onclick="steal()">Hi<script>alert(1)</script><style>p{}</style><iframe src="x"></iframe></p><img src=x onerror=alert(1)>');
    expect(out).toBe('<p>Hi</p>');
    expect(sanitizeHtml('<scr<script>ipt>alert(1)</script>')).not.toMatch(/<script/i);
  });

  it('allows only http(s)/mailto links and marks them noopener', () => {
    expect(sanitizeHtml('<a href="https://lexisora.com/policy">policy</a>')).toBe('<a href="https://lexisora.com/policy" rel="noopener nofollow" target="_blank">policy</a>');
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="jav&#x61;script&colon;alert(1)">x</a>')).toBe('<a>x</a>');
  });

  it('allows only tenant file images', () => {
    expect(sanitizeHtml('<img src="/api/v1/files/abc123" alt="Team" width="640">')).toBe('<img src="/api/v1/files/abc123" alt="Team" width="640">');
    expect(sanitizeHtml('<img src="https://evil.example/track.png">')).toBe('');
    expect(imageFileIds('<img src="/api/v1/files/abc123"><img src="/api/v1/files/def_4">')).toEqual(['abc123', 'def_4']);
  });

  it('escapes stray angle brackets and closes open tags', () => {
    expect(sanitizeHtml('<p>2 < 3 and 5 > 4')).toBe('<p>2  3 and 5 &gt; 4</p>');
    expect(sanitizeHtml('<ul><li>open')).toBe('<ul><li>open</li></ul>');
  });
});

describe('excerpts', () => {
  it('turns HTML into a single line of text', () => {
    expect(htmlToText('<p><strong>8 Nov, 4 pm onwards on the terrace.</strong> Sign up for a dish by 1 Nov.</p>')).toBe('8 Nov, 4 pm onwards on the terrace. Sign up for a dish by 1 Nov.');
    expect(htmlToText('<h2>When</h2><ul><li>1 Oct</li><li>15 Oct</li></ul>')).toBe('When 1 Oct 15 Oct');
    expect(htmlToText('Tom &amp; Jerry&nbsp;&lt;3')).toBe('Tom & Jerry <3');
  });

  it('truncates with an ellipsis at the limit', () => {
    const e = excerptOf(`<p>${'word '.repeat(100)}</p>`, 300);
    expect(e.length).toBeLessThanOrEqual(300);
    expect(e.endsWith('…')).toBe(true);
    expect(excerptOf('<p>Short</p>')).toBe('Short');
  });
});
