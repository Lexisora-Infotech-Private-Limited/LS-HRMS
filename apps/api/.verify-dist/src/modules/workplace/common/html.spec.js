"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _html = require("./html");
(0, _vitest.describe)('rich-text sanitizer (notice / feed bodies)', ()=>{
    (0, _vitest.it)('keeps the allowlist and normalises b/i/div/h1', ()=>{
        (0, _vitest.expect)((0, _html.sanitizeHtml)('<h1>Title</h1><div><b>Bold</b> and <i>it</i></div><ul><li>one</li></ul>')).toBe('<h2>Title</h2><p><strong>Bold</strong> and <em>it</em></p><ul><li>one</li></ul>');
    });
    (0, _vitest.it)('removes scripts, styles, iframes and event handlers', ()=>{
        const out = (0, _html.sanitizeHtml)('<p onclick="steal()">Hi<script>alert(1)</script><style>p{}</style><iframe src="x"></iframe></p><img src=x onerror=alert(1)>');
        (0, _vitest.expect)(out).toBe('<p>Hi</p>');
        (0, _vitest.expect)((0, _html.sanitizeHtml)('<scr<script>ipt>alert(1)</script>')).not.toMatch(/<script/i);
    });
    (0, _vitest.it)('allows only http(s)/mailto links and marks them noopener', ()=>{
        (0, _vitest.expect)((0, _html.sanitizeHtml)('<a href="https://lexisora.com/policy">policy</a>')).toBe('<a href="https://lexisora.com/policy" rel="noopener nofollow" target="_blank">policy</a>');
        (0, _vitest.expect)((0, _html.sanitizeHtml)('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
        (0, _vitest.expect)((0, _html.sanitizeHtml)('<a href="jav&#x61;script&colon;alert(1)">x</a>')).toBe('<a>x</a>');
    });
    (0, _vitest.it)('allows only tenant file images', ()=>{
        (0, _vitest.expect)((0, _html.sanitizeHtml)('<img src="/api/v1/files/abc123" alt="Team" width="640">')).toBe('<img src="/api/v1/files/abc123" alt="Team" width="640">');
        (0, _vitest.expect)((0, _html.sanitizeHtml)('<img src="https://evil.example/track.png">')).toBe('');
        (0, _vitest.expect)((0, _html.imageFileIds)('<img src="/api/v1/files/abc123"><img src="/api/v1/files/def_4">')).toEqual([
            'abc123',
            'def_4'
        ]);
    });
    (0, _vitest.it)('escapes stray angle brackets and closes open tags', ()=>{
        (0, _vitest.expect)((0, _html.sanitizeHtml)('<p>2 < 3 and 5 > 4')).toBe('<p>2  3 and 5 &gt; 4</p>');
        (0, _vitest.expect)((0, _html.sanitizeHtml)('<ul><li>open')).toBe('<ul><li>open</li></ul>');
    });
});
(0, _vitest.describe)('excerpts', ()=>{
    (0, _vitest.it)('turns HTML into a single line of text', ()=>{
        (0, _vitest.expect)((0, _html.htmlToText)('<p><strong>8 Nov, 4 pm onwards on the terrace.</strong> Sign up for a dish by 1 Nov.</p>')).toBe('8 Nov, 4 pm onwards on the terrace. Sign up for a dish by 1 Nov.');
        (0, _vitest.expect)((0, _html.htmlToText)('<h2>When</h2><ul><li>1 Oct</li><li>15 Oct</li></ul>')).toBe('When 1 Oct 15 Oct');
        (0, _vitest.expect)((0, _html.htmlToText)('Tom &amp; Jerry&nbsp;&lt;3')).toBe('Tom & Jerry <3');
    });
    (0, _vitest.it)('truncates with an ellipsis at the limit', ()=>{
        const e = (0, _html.excerptOf)(`<p>${'word '.repeat(100)}</p>`, 300);
        (0, _vitest.expect)(e.length).toBeLessThanOrEqual(300);
        (0, _vitest.expect)(e.endsWith('…')).toBe(true);
        (0, _vitest.expect)((0, _html.excerptOf)('<p>Short</p>')).toBe('Short');
    });
});

//# sourceMappingURL=html.spec.js.map