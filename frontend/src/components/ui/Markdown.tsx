/**
 * Markdown — tiny, safe renderer for copilot answers (paragraphs, bullet and
 * numbered lists, pipe tables, **bold**, `code`, headings). Produces React
 * elements only; never injects HTML.
 */

import { Fragment } from "react";

function inline(text: string, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={`${key}-${i}`} className="rounded bg-slate-100 px-1 text-[0.85em]">{p.slice(1, -1)}</code>;
    return <Fragment key={`${key}-${i}`}>{p}</Fragment>;
  });
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={`t${i}`} className="overflow-x-auto"><table>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `h${j}`)}</th>)}</tr></thead>
          <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, `c${k}${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+\.)\s+/, ""));
        i++;
      }
      const L = ordered ? "ol" : "ul";
      out.push(<L key={`l${i}`} className={ordered ? "list-decimal pl-5" : ""}>{items.map((it, j) => <li key={j}>{inline(it, `li${i}${j}`)}</li>)}</L>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      out.push(<p key={`h${i}`} className="mt-2 font-semibold text-slate-800">{inline(h[2], `hh${i}`)}</p>);
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("|") && !/^\s*([-*•]|\d+\.)\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(<p key={`p${i}`}>{inline(para.join(" "), `p${i}`)}</p>);
  }
  return <div className="prose-chat text-sm text-slate-700">{out}</div>;
}
