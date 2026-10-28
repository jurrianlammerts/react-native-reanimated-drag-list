import {
  getSectionAtPosition,
  wouldPassiveSwapCrossSection,
} from '../sectionSwap';

const lockedKeys: Record<string, boolean> = {
  'header-day-1': true,
  'header-day-2': true,
  'header-no-day': true,
  'a': false,
  'b': false,
  'c': false,
  'u1': false,
};

const sectionByKey: Record<string, string> = {
  'header-day-1': 'header-day-1',
  'header-day-2': 'header-day-2',
  'header-no-day': 'header-no-day',
  'a': 'header-day-1',
  'b': 'header-day-1',
  'c': 'header-day-2',
  'u1': 'header-no-day',
};

const positions = {
  'header-day-1': 0,
  'a': 1,
  'b': 2,
  'header-day-2': 3,
  'c': 4,
  'header-no-day': 5,
  'u1': 6,
};

const allKeys = [
  'header-day-1',
  'a',
  'b',
  'header-day-2',
  'c',
  'header-no-day',
  'u1',
];

describe('getSectionAtPosition', () => {
  it('returns the section for a place row', () => {
    expect(
      getSectionAtPosition(1, positions, allKeys, sectionByKey, lockedKeys)
    ).toBe('header-day-1');
    expect(
      getSectionAtPosition(6, positions, allKeys, sectionByKey, lockedKeys)
    ).toBe('header-no-day');
  });

  it('returns the header section when position is a header', () => {
    expect(
      getSectionAtPosition(5, positions, allKeys, sectionByKey, lockedKeys)
    ).toBe('header-no-day');
  });
});

describe('wouldPassiveSwapCrossSection', () => {
  it('blocks moving an unassigned place into day 2', () => {
    expect(
      wouldPassiveSwapCrossSection(
        'u1',
        4,
        sectionByKey,
        positions,
        allKeys,
        lockedKeys
      )
    ).toBe(true);
  });

  it('allows moving a place within the same section', () => {
    expect(
      wouldPassiveSwapCrossSection(
        'a',
        2,
        sectionByKey,
        positions,
        allKeys,
        lockedKeys
      )
    ).toBe(false);
  });

  it('blocks moving a day 2 place into unassigned', () => {
    expect(
      wouldPassiveSwapCrossSection(
        'c',
        6,
        sectionByKey,
        positions,
        allKeys,
        lockedKeys
      )
    ).toBe(true);
  });

  it('returns false when section constraints are empty', () => {
    expect(
      wouldPassiveSwapCrossSection('u1', 4, {}, positions, allKeys, lockedKeys)
    ).toBe(false);
  });
});
