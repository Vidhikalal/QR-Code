import { describe, expect, it } from 'vitest';
import { mintPublicId } from '@/lib/badge/mint';
import { normalizeUid, parseTagCsv, parseTagUrl, tagUrl } from '@/lib/badge/tags';

const ME = 'https://me.club.test';

describe('badge ids and URLs (PLAN D3, §11.3)', () => {
  it('T-NFC-01: 10,000 minted public ids are unique, 12 chars, base64url', () => {
    const ids = Array.from({ length: 10_000 }, mintPublicId);
    expect(new Set(ids).size).toBe(10_000);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it('T-NFC-02: parseTagUrl accepts exactly our tag URL (optional trailing slash) and never throws', () => {
    const id = 'AbCdEf012_-x';
    expect(tagUrl(ME, id)).toBe(`${ME}/t/${id}`);
    expect(parseTagUrl(`${ME}/t/${id}`, ME)).toEqual({ ok: true, publicId: id });
    expect(parseTagUrl(` ${ME}/t/${id}/ `, ME)).toEqual({ ok: true, publicId: id });
    for (const bad of [
      `https://evil.test/t/${id}`,
      `http://me.club.test/t/${id}`,
      `${ME}/t/${id}?x=1`,
      `${ME}/t/${id}#frag`,
      `${ME}/t/${id.slice(1)}`,
      `${ME}/t/${id}A`,
      `${ME}/p#${id}`,
      id,
      '',
      'x'.repeat(5000),
      '🙂',
    ]) {
      expect(parseTagUrl(bad, ME), bad.slice(0, 40)).toEqual({ ok: false });
    }
    expect(parseTagUrl(null as unknown as string, ME)).toEqual({ ok: false });
  });

  it('T-NFC-03: normalizeUid turns common serial formats into uppercase hex, or null', () => {
    for (const raw of ['04:a2:3b:4c:5d:6e:7f', '04A23B4C5D6E7F', '04-a2-3b-4c-5d-6e-7f', '04 A2 3B 4C 5D 6E 7F']) {
      expect(normalizeUid(raw), raw).toBe('04A23B4C5D6E7F');
    }
    expect(normalizeUid('04A23B4')).toBeNull(); // odd length
    expect(normalizeUid('04A23B')).toBeNull(); // 6 < 8
    expect(normalizeUid('A'.repeat(22))).toBeNull(); // 22 > 20
    expect(normalizeUid('04:zz:3b:4c')).toBeNull();
    expect(normalizeUid('')).toBeNull();
  });
});

describe('vendor tag CSV (PLAN F19 B)', () => {
  it('T-TAG-13 (parse): url or public_id column, uid, optional label; BOM, CRLF and quotes', () => {
    const csv = '﻿url,uid,label\r\n' + `${ME}/t/AAAAAAAAAAAA,04:a2:3b:4c:5d:6e:7f,B-1\r\n` + `"${ME}/t/BBBBBBBBBBBB","04A23B4C5D6E80","B,2"\r\n` + 'not-a-url,04A23B4C5D6E81,\r\n' + `${ME}/t/CCCCCCCCCCCC,zz,\r\n`;
    expect(parseTagCsv(csv, ME)).toEqual({
      ok: true,
      rows: [
        { row: 1, publicId: 'AAAAAAAAAAAA', uid: '04A23B4C5D6E7F', label: 'B-1' },
        { row: 2, publicId: 'BBBBBBBBBBBB', uid: '04A23B4C5D6E80', label: 'B,2' },
        { row: 3, error: 'public_id' },
        { row: 4, error: 'uid' },
      ],
    });
    expect(parseTagCsv('public_id,uid\nDDDDDDDDDDDD,04A23B4C5D6E82\n', ME)).toEqual({
      ok: true,
      rows: [{ row: 1, publicId: 'DDDDDDDDDDDD', uid: '04A23B4C5D6E82', label: null }],
    });
  });

  it('T-TAG-13 (parse): missing columns or an empty file are rejected as a whole', () => {
    expect(parseTagCsv('uid,label\n04A23B4C5D6E82,x\n', ME)).toEqual({ ok: false, error: 'header' });
    expect(parseTagCsv('', ME)).toEqual({ ok: false, error: 'header' });
  });
});
