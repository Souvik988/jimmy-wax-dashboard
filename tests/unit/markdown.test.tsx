import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Markdown, parseMarkdown, safeHref, unsupportedMarkdown } from '@/lib/markdown';

describe('policy markdown subset', () => {
  it('parses headings, lists, quotes and paragraphs', () => {
    const blocks = parseMarkdown('# Title\n\nHello **world**\nsecond line\n\n- a\n- b\n\n1. one\n2. two\n\n> note');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote']);
    expect(blocks[1]).toMatchObject({ text: 'Hello **world** second line' });
    expect(blocks[3]).toMatchObject({ ordered: true, items: ['one', 'two'] });
  });
  it('escapes HTML and removes unsafe links', () => {
    const html = renderToStaticMarkup(<Markdown source={'<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://example.com)'} />);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('allows only https and mailto and warns about unsupported syntax', () => {
    expect(safeHref('https://a.b')).toBeTruthy();
    expect(safeHref('mailto:a@b.co')).toBeTruthy();
    expect(safeHref('http://a.b')).toBeNull();
    expect(safeHref('data:text/html,1')).toBeNull();
    expect(unsupportedMarkdown('<b>x</b> ![i](https://a.b/c.png) [bad](ftp://x)').length).toBe(3);
    expect(unsupportedMarkdown('# Fine\n\nPlain text.')).toEqual([]);
  });
});
