import { describe, expect, it } from 'vitest';
import { holidayLocationsOverlap } from '@lexisora/shared';

describe('one holiday per date and location', () => {
  it('two all-location holidays on one date clash (Dussehra + another)', () => {
    expect(holidayLocationsOverlap([], [])).toBe(true);
  });
  it('an all-location holiday clashes with any location-specific one', () => {
    expect(holidayLocationsOverlap([], ['ahmedabad'])).toBe(true);
    expect(holidayLocationsOverlap(['pune'], [])).toBe(true);
  });
  it('holidays for different locations on one date do not clash', () => {
    expect(holidayLocationsOverlap(['ahmedabad'], ['pune'])).toBe(false);
  });
  it('a shared location clashes', () => {
    expect(holidayLocationsOverlap(['ahmedabad', 'pune'], ['pune'])).toBe(true);
  });
});
