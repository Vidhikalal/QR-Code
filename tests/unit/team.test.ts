import { describe, expect, it } from 'vitest';
import { formatJoinCode, generateJoinCode, JOIN_CODE_RE, normalizeJoinCode, parseTeamName, parseTrackNames } from '@/lib/domain/team';

describe('teams (SPEC F15, v0.7)', () => {
  it('T-TEAM-01: join codes are 8 characters without look-alikes; typed codes ignore case, spaces and dashes', () => {
    const codes = Array.from({ length: 1000 }, generateJoinCode);
    for (const c of codes) expect(c).toMatch(JOIN_CODE_RE);
    expect(new Set(codes).size).toBeGreaterThan(990);
    expect(codes.join('')).not.toMatch(/[IO01]/);

    expect(normalizeJoinCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizeJoinCode('k7q4 mz2a')).toBe('K7Q4MZ2A');
    for (const bad of ['', 'ABCDEFG', 'ABCDEFGHJ', 'ABCDEFGI', 'ABCD0EFG', 'ABCD_EFG', 'x'.repeat(2048)]) expect(normalizeJoinCode(bad), bad).toBeNull();
    expect(formatJoinCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });

  it('T-TEAM-01: team names are trimmed, 1 to 60 characters; track lines are trimmed, unique, 1 to 100 characters, at most 20', () => {
    expect(parseTeamName('  Data Wizards ')).toBe('Data Wizards');
    expect(parseTeamName('x'.repeat(60))).toBe('x'.repeat(60));
    for (const bad of ['', '   ', 'x'.repeat(61), 'Data\r\nBcc: x@y.z', 'Tab\there']) expect(parseTeamName(bad), bad).toBeNull();

    expect(parseTrackNames('Best AI/ML Project\r\n\n  Best Hardware Project \nbest ai/ml project\n')).toEqual(['Best AI/ML Project', 'Best Hardware Project']);
    expect(parseTrackNames('x'.repeat(100))).toEqual(['x'.repeat(100)]);
    expect(parseTrackNames('x'.repeat(101))).toBeNull();
    expect(parseTrackNames(Array.from({ length: 21 }, (_, i) => `Track ${i}`).join('\n'))).toBeNull();
    expect(parseTrackNames(' \n \n')).toBeNull();
  });
});
