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

// F10 (v0.11.22): reads a CSV export of the Sheet (RFC 4180: quoted fields, `""`, CRLF or LF) into
// rows of cells, for mapSheetValues(). A leading BOM is dropped; blank lines are skipped.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.startsWith('﻿') ? text.slice(1) : text;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}
