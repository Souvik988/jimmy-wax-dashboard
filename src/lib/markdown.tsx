import type { ReactNode } from 'react';

/**
 * Safe Markdown subset for policy/legal copy: headings (#–###), paragraphs, bullet and numbered lists, blockquotes,
 * **bold**, *italic*, `code` and [links](https://…|mailto:…). Raw HTML and images are never rendered; React escapes all text.
 */
export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string };

export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = (): void => { if (paragraph.length) { blocks.push({ kind: 'paragraph', text: paragraph.join(' ') }); paragraph = []; } };
  const flushList = (): void => { if (list) { blocks.push({ kind: 'list', ordered: list.ordered, items: list.items }); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/u.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
    const quote = /^>\s?(.*)$/u.exec(line);
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    if (heading) { flushParagraph(); flushList(); blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! }); continue; }
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    if (quote) { flushParagraph(); flushList(); blocks.push({ kind: 'quote', text: quote[1]! }); continue; }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph(); flushList();
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/gu;

export function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'mailto:' ? url.toString() : null;
  } catch { return null; }
}

export function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).filter((part) => part !== '').map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/u.exec(part);
    if (link) {
      const href = safeHref(link[2]!);
      return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{link[1]}</a> : <span key={index}>{link[1]} (link removed: only https and mailto are allowed)</span>;
    }
    return part;
  });
}

export function Markdown({ source }: { source: string }): ReactNode {
  return <div>{parseMarkdown(source).map((block, index) => {
    switch (block.kind) {
      case 'heading': { const Tag = (`h${block.level + 1}`) as 'h2' | 'h3' | 'h4'; return <Tag key={index}>{renderInline(block.text)}</Tag>; }
      case 'list': { const Tag = block.ordered ? 'ol' : 'ul'; return <Tag key={index}>{block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}</Tag>; }
      case 'quote': return <blockquote key={index}>{renderInline(block.text)}</blockquote>;
      default: return <p key={index}>{renderInline(block.text)}</p>;
    }
  })}</div>;
}

/** Things authors may type that this renderer will not show (so the editor can warn instead of silently dropping them). */
export function unsupportedMarkdown(source: string): string[] {
  const issues: string[] = [];
  if (/<\/?[a-z][^>]*>/iu.test(source)) issues.push('Raw HTML is not rendered.');
  if (/!\[[^\]]*\]\([^)]*\)/u.test(source)) issues.push('Images are not supported in policy pages.');
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/gu)) if (!safeHref(match[1]!)) issues.push(`Link “${match[1]}” will be removed (only https and mailto links are allowed).`);
  if (/^\s*\|.+\|\s*$/mu.test(source)) issues.push('Tables are not supported.');
  return [...new Set(issues)];
}
