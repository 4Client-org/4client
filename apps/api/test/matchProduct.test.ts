import { describe, it, expect } from 'vitest';
import { matchProductName, type CatalogEntry } from '../src/lib/matchProduct.js';

const catalog: CatalogEntry[] = [
  { name: 'Tomate' },
  { name: 'Cebolla' },
  { name: 'Papa criolla' },
  { name: 'Papa pastusa' },
  { name: 'Aguacate' },
];

describe('matchProductName', () => {
  it('exact match, accent/case-insensitive', () => {
    const r = matchProductName('tomate', catalog);
    expect(r).toEqual({ matched: true, name: 'Tomate' });
  });

  it('exact match after singularizing a plural', () => {
    const r = matchProductName('tomates', catalog);
    expect(r.matched).toBe(true);
    expect(r.name).toBe('Tomate');
  });

  it('unambiguous substring match', () => {
    const r = matchProductName('aguacates', catalog);
    expect(r.matched).toBe(true);
    expect(r.name).toBe('Aguacate');
  });

  it('ambiguous substring match (two catalog products both contain the term) -> unmatched', () => {
    const r = matchProductName('papa', catalog);
    expect(r.matched).toBe(false);
    expect(r.name).toBe('papa');
  });

  it('fuzzy match within threshold catches a typo', () => {
    const r = matchProductName('cebola', catalog); // missing one 'l'
    expect(r.matched).toBe(true);
    expect(r.name).toBe('Cebolla');
  });

  it('two close fuzzy candidates within the margin -> unmatched, no coin-flip', () => {
    // "papa" variants score similarly close to both "Papa criolla" and "Papa
    // pastusa" once "papa" itself falls through the ambiguous-substring check -
    // reuse that same case to confirm fuzzy matching doesn't guess either.
    const r = matchProductName('papas', catalog);
    expect(r.matched).toBe(false);
  });

  it('no match at all -> unmatched with the raw text', () => {
    const r = matchProductName('zanahoria', catalog);
    expect(r).toEqual({ matched: false, name: 'zanahoria' });
  });
});
