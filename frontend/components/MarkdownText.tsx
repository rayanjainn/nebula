"use client";
import React from "react";

/**
 * Renders a subset of markdown inline + block formatting:
 *   **bold**  →  <strong>
 *   *italic*  →  <em>
 *   `code`    →  <code>
 *   # H1 / ## H2 / ### H3  →  heading divs
 *   - item    →  bullet list
 *   1. item   →  numbered list
 *   blank line  →  paragraph break
 *
 * No external dependency — pure React with regex.
 */

function parseLine(line: string, key: number): React.ReactNode {
  // Process inline: **bold**, *italic*, `code`
  const parts: React.ReactNode[] = [];
  // Combined regex for inline patterns
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    if (m[2]) parts.push(<strong key={m.index}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={m.index}>{m[3]}</em>);
    else if (m[4]) parts.push(<code key={m.index} className="font-mono text-[90%] px-1 py-0.5 bg-slate-100 rounded text-slate-800">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));

  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <React.Fragment key={key}>{parts}</React.Fragment>;
}

export default function MarkdownText({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  if (!children) return null;

  const lines = children.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let listItems: React.ReactNode[] = [];
  let listType: "ul" | "ol" | null = null;

  function flushList() {
    if (!listItems.length) return;
    if (listType === "ul") {
      nodes.push(
        <ul key={`ul-${i}`} className="list-none space-y-1 my-2">
          {listItems}
        </ul>
      );
    } else {
      nodes.push(
        <ol key={`ol-${i}`} className="list-none space-y-1 my-2">
          {listItems}
        </ol>
      );
    }
    listItems = [];
    listType = null;
  }

  for (const rawLine of lines) {
    const line = rawLine;

    // Headings
    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    // Bullets: - or * or •
    const bullet = line.match(/^[\-\*•] (.+)/);
    // Numbered: 1. 2. etc
    const numbered = line.match(/^\d+\. (.+)/);
    // Horizontal rule
    const hr = line.match(/^---+$/);
    // Bold-only line used as sub-heading (e.g. **Executive Summary**)
    const boldHeading = line.match(/^\*\*(.+)\*\*[:：]?$/);

    if (h1 || h2 || h3) {
      flushList();
      const text = (h1?.[1] ?? h2?.[1] ?? h3?.[1]) || "";
      const cls = h1
        ? "text-base font-bold text-slate-900 mt-4 mb-1"
        : h2
        ? "text-sm font-bold text-slate-800 mt-3 mb-1"
        : "text-xs font-bold text-slate-700 mt-2 mb-0.5 uppercase tracking-wide";
      nodes.push(<p key={i} className={cls}>{parseLine(text, i)}</p>);
    } else if (boldHeading) {
      flushList();
      nodes.push(
        <p key={i} className="text-xs font-bold text-slate-800 mt-3 mb-0.5 uppercase tracking-wide">
          {boldHeading[1]}
        </p>
      );
    } else if (hr) {
      flushList();
      nodes.push(<hr key={i} className="border-slate-200 my-3" />);
    } else if (bullet) {
      if (listType === "ol") flushList();
      listType = "ul";
      listItems.push(
        <li key={i} className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mt-2 shrink-0" />
          <span>{parseLine(bullet[1], i)}</span>
        </li>
      );
    } else if (numbered) {
      if (listType === "ul") flushList();
      listType = "ol";
      const num = listItems.length + 1;
      listItems.push(
        <li key={i} className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed">
          <span className="text-xs font-bold text-indigo-500 w-4 mt-0.5 shrink-0">{num}.</span>
          <span>{parseLine(numbered[1], i)}</span>
        </li>
      );
    } else if (line.trim() === "") {
      flushList();
      // blank line → small gap (don't add extra nodes, spacing comes from parent)
    } else {
      flushList();
      nodes.push(
        <p key={i} className="text-sm text-slate-700 leading-relaxed">
          {parseLine(line, i)}
        </p>
      );
    }

    i++;
  }

  flushList();

  return <div className={`space-y-1 ${className}`}>{nodes}</div>;
}
