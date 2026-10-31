import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '@/lib/domain/csv';

describe('toCsv (SPEC §13, I-13)', () => {
  it('T-ANA-04: BOM, CRLF, every field quoted, quotes doubled, formula-injection guard', () => {
    const csv = toCsv(
      ['name', 'note'],
      [
        ['=SUM(A1)', '+1'],
        ['-1', '@x'],
        ['"quoted"', 'a,b'],
        ['line1\nline2', '\tTAB'],
        ['\rCR', null],
        ['Zoë', 42],
      ],
    );
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe(
      '﻿' +
        '"name","note"\r\n' +
        `"'=SUM(A1)","'+1"\r\n` +
        `"'-1","'@x"\r\n` +
        '"""quoted""","a,b"\r\n' +
        `"line1\nline2","'\tTAB"\r\n` +
        `"'\rCR",""\r\n` +
        '"Zoë","42"\r\n',
    );
  });

  it('T-ANA-04: an empty table is just the header row', () => {
    expect(toCsv(['a'], [])).toBe('﻿"a"\r\n');
  });
});

describe('parseCsv (SPEC F10, v0.11.22)', () => {
  it('T-ING-28: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF, BOM, blank lines', () => {
    expect(parseCsv('\uFEFFApplicant ID,Email Address\r\n"a1","x@y.co"\r\n\r\nb2,"say ""hi"", ok"\n"c3","two\nlines"')).toEqual([
      ['Applicant ID', 'Email Address'],
      ['a1', 'x@y.co'],
      ['b2', 'say "hi", ok'],
      ['c3', 'two\nlines'],
    ]);
  });

  it('T-ING-28: empty cells survive, including a trailing one; empty input is no rows; never throws', () => {
    expect(parseCsv('a,,c,\n')).toEqual([['a', '', 'c', '']]);
    expect(parseCsv('')).toEqual([]);
    expect(() => parseCsv('"unterminated,\n')).not.toThrow();
  });

  it('T-ING-28: reads back what toCsv writes', () => {
    expect(parseCsv(toCsv(['Applicant ID', 'Notes'], [['a1', 'Zoë, "hi"\nthere']]))).toEqual([
      ['Applicant ID', 'Notes'],
      ['a1', 'Zoë, "hi"\nthere'],
    ]);
  });
});
