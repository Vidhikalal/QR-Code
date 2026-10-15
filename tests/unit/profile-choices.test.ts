import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DIETARY_OPTIONS,
  MAX_SKILLS,
  SKILL_OPTIONS,
  YEAR_OPTIONS,
  formatDietary,
  parseDietary,
  parseSkillsAnswer,
  parseYear,
} from '@/lib/profile/choices';

// Profiles demo feedback (2026-10-14): Year, dietary restrictions and skills are picked from lists,
// on /me and on the Google Form. Google joins checkbox answers with ", " and appends the "Other"
// text last, so answers are matched against the known options first and the rest is one Other value.
describe('profile choice lists', () => {
  it('Year has the six agreed options', () => {
    expect(YEAR_OPTIONS).toEqual(['1st year', '2nd year', '3rd year', '4th year', '5+ year', 'Alumni']);
  });

  it('options are unique, comma-free (Google joins answers with commas) and fit the 30-character skill limit', () => {
    for (const list of [YEAR_OPTIONS, DIETARY_OPTIONS, SKILL_OPTIONS]) {
      expect(new Set(list.map((x) => x.toLowerCase())).size).toBe(list.length);
      for (const x of list) expect(x, x).not.toMatch(/[,;\n]/);
    }
    for (const s of SKILL_OPTIONS) expect([...s].length, s).toBeLessThanOrEqual(30);
    expect(SKILL_OPTIONS.length).toBeGreaterThanOrEqual(15);
    expect(MAX_SKILLS).toBe(3);
  });

  it('the Google Form (apps-script/Setup.gs) offers exactly the same lists', () => {
    const gs = readFileSync('apps-script/Setup.gs', 'utf8');
    const list = (name: string) => {
      const block = new RegExp(`const ${name} = \\[([^\\]]*)\\];`).exec(gs)?.[1] ?? '';
      return [...block.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    };
    expect(list('YEAR_OPTIONS')).toEqual([...YEAR_OPTIONS]);
    expect(list('DIETARY_OPTIONS')).toEqual([...DIETARY_OPTIONS]);
    expect(list('SKILL_OPTIONS')).toEqual([...SKILL_OPTIONS]);
  });

  it('parseYear accepts an option in any case, anything else is dropped', () => {
    expect(parseYear('3rd year')).toBe('3rd year');
    expect(parseYear(' alumni ')).toBe('Alumni');
    expect(parseYear('5+ YEAR')).toBe('5+ year');
    expect(parseYear('Senior')).toBeNull();
    expect(parseYear('')).toBeNull();
    expect(parseYear(undefined)).toBeNull();
  });
});

describe('dietary restrictions: several options plus Other, stored as one text', () => {
  it('formatDietary lists the options in list order, then the Other text; nothing chosen is null', () => {
    expect(formatDietary(['Nut allergy', 'Vegan'], '')).toBe('Vegan, Nut allergy');
    expect(formatDietary(['Halal'], '  no gelatin  ')).toBe('Halal, no gelatin');
    expect(formatDietary([], 'no mushrooms')).toBe('no mushrooms');
    expect(formatDietary([], '   ')).toBeNull();
  });

  it('parseDietary reads the stored text back into options and Other, whatever the case', () => {
    expect(parseDietary(null)).toEqual({ chosen: [], other: '' });
    expect(parseDietary('vegetarian, NUT ALLERGY')).toEqual({ chosen: ['Vegetarian', 'Nut allergy'], other: '' });
    expect(parseDietary('Halal, no pork gelatin, please')).toEqual({ chosen: ['Halal'], other: 'no pork gelatin, please' });
    expect(parseDietary('Allergic to everything')).toEqual({ chosen: [], other: 'Allergic to everything' });
  });

  it('round-trips', () => {
    const text = formatDietary(['Vegan', 'Gluten-free'], 'no sesame, no soy');
    expect(parseDietary(text)).toEqual({ chosen: ['Vegan', 'Gluten-free'], other: 'no sesame, no soy' });
  });
});

describe('"What are you good at?": top 3 from the list, plus Other', () => {
  it('known options come back in their own spelling; the rest is one custom skill, even with commas', () => {
    expect(parseSkillsAnswer('frontend, AI / ML')).toEqual(['Frontend', 'AI / ML']);
    expect(parseSkillsAnswer('Frontend, Rust, Go')).toEqual(['Frontend', 'Rust, Go']);
    expect(parseSkillsAnswer('Knitting')).toEqual(['Knitting']);
  });

  it('keeps at most 3, drops duplicates, and cuts an over-long Other to 30 characters', () => {
    expect(parseSkillsAnswer('Frontend, Backend, Mobile apps, Databases')).toEqual(['Frontend', 'Backend', 'Mobile apps']);
    expect(parseSkillsAnswer('Frontend, frontend')).toEqual(['Frontend']);
    const long = parseSkillsAnswer(`Backend, ${'x'.repeat(40)}`);
    expect(long).toEqual(['Backend', 'x'.repeat(30)]);
    expect(parseSkillsAnswer('')).toEqual([]);
    expect(parseSkillsAnswer(undefined)).toEqual([]);
  });
});
