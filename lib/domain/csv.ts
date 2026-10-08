// SPEC §13 CSV rules. Every export goes through here (I-13).
// UTF-8 BOM (so Excel shows accents), CRLF, every field quoted, `"` doubled, and a `'` prefix on any
// cell that a spreadsheet would treat as a formula.
export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r']);

function cell(value: CsvCell): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (s.length > 0 && FORMULA_START.has(s[0] ?? '')) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((r) => r.map(cell).join(','));
  return `﻿${lines.map((l) => `${l}\r\n`).join('')}`;
}

// RFC 4180 reader for uploaded files (vendor tag lists). Tolerates a BOM, CRLF or LF, quoted fields
// with doubled quotes, and a missing final newline. Returns rows of raw cells; callers validate.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.startsWith('﻿') ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
