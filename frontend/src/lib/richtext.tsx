import { Fragment, type ReactNode } from "react";

/**
 * Turns a hackathon description into readable blocks. The AI-tidied copy is
 * Markdown; raw descriptions come in every shape (plain paragraphs, Markdown,
 * sentences broken across lines), so the parser is forgiving: it rejoins
 * broken lines, spots short title-like lines as headings, keeps lists, and
 * turns links, bare URLs and emails into links.
 */

export type Block = { kind: "h"; text: string } | { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] };

const BULLET = /^\s*(?:[-*•▪◦·]|\d{1,2}[.)])\s+/;
const ORDERED = /^\s*\d{1,2}[.)]\s+/;
const HEADING = /^\s*#{1,6}\s+/;

function looksLikeHeading(text: string, next: string | undefined): boolean {
  const t = text.replace(/\*\*/g, "").trim();
  if (!next || t.length > 48 || t.length < 3) return false;
  if (/[.!?,;]$/.test(t) || /https?:\/\//.test(t)) return false;
  return /:$/.test(t) || t.split(/\s+/).length <= 6;
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r/g, "").split("\n");
  // First pass: group lines into raw chunks separated by blank lines, but keep list items apart.
  const chunks: { list: boolean; ordered: boolean; heading: boolean; lines: string[] }[] = [];
  let cur: (typeof chunks)[number] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      cur = null;
      continue;
    }
    if (HEADING.test(line)) {
      chunks.push({ list: false, ordered: false, heading: true, lines: [line.replace(HEADING, "")] });
      cur = null;
      continue;
    }
    if (BULLET.test(line)) {
      const ordered = ORDERED.test(line);
      if (!cur || !cur.list || cur.ordered !== ordered) {
        cur = { list: true, ordered, heading: false, lines: [] };
        chunks.push(cur);
      }
      cur.lines.push(line.replace(BULLET, ""));
      continue;
    }
    if (cur?.list) {
      // A wrapped list item continues the previous one.
      cur.lines[cur.lines.length - 1] += ` ${line}`;
      continue;
    }
    if (!cur) {
      cur = { list: false, ordered: false, heading: false, lines: [] };
      chunks.push(cur);
    }
    cur.lines.push(line);
  }

  const blocks: Block[] = [];
  chunks.forEach((c, i) => {
    if (c.heading) return void blocks.push({ kind: "h", text: c.lines[0] });
    if (c.list) return void blocks.push({ kind: c.ordered ? "ol" : "ul", items: c.lines });
    const text = c.lines.join(" ").replace(/\s+/g, " ").trim();
    const next = chunks[i + 1]?.lines[0];
    if (looksLikeHeading(text, next)) blocks.push({ kind: "h", text: text.replace(/:$/, "").replace(/\*\*/g, "") });
    else blocks.push({ kind: "p", text });
  });
  return blocks;
}

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)|((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"])|([\w.+-]+@[\w-]+\.[\w.-]+\w)/g;

/** Bold, links, bare URLs and emails, as React nodes. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const key = i++;
    if (m[1]) out.push(<strong key={key} className="font-semibold text-label">{m[1]}</strong>);
    else if (m[2]) out.push(<Link key={key} href={m[3]}>{m[2]}</Link>);
    else if (m[4]) out.push(<Link key={key} href={m[4].startsWith("www.") ? `https://${m[4]}` : m[4]}>{prettyUrl(m[4])}</Link>);
    else if (m[5]) out.push(<Link key={key} href={`mailto:${m[5]}`}>{m[5]}</Link>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function prettyUrl(u: string): string {
  const s = u.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  return s.length > 42 ? `${s.slice(0, 40)}…` : s;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium break-words text-tint underline decoration-[color-mix(in_srgb,var(--tint)_35%,transparent)] underline-offset-2">
      {children}
    </a>
  );
}

export function RichText({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-3 text-subhead leading-[1.5] text-label-2">
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {b.kind === "h" && <h3 className="pt-2 text-callout font-semibold tracking-[-0.015em] text-label">{inline(b.text)}</h3>}
          {b.kind === "p" && <p>{inline(b.text)}</p>}
          {(b.kind === "ul" || b.kind === "ol") && (
            <ul className="space-y-1.5">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-2.5">
                  {b.kind === "ol" ? (
                    <span className="w-4 shrink-0 text-right font-semibold text-tint tabular">{j + 1}.</span>
                  ) : (
                    <span className="mt-[0.6em] h-[5px] w-[5px] shrink-0 rounded-full bg-tint" />
                  )}
                  <span className="min-w-0">{inline(it)}</span>
                </li>
              ))}
            </ul>
          )}
        </Fragment>
      ))}
    </div>
  );
}
