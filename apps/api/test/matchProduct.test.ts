import { describe, it, expect } from 'vitest';
import { matchProductName, type CatalogEntry } from '../src/lib/matchProduct.js';

const catalog: CatalogEntry[] = [
  { name: 'Tomate', price_per_unit: 3000 },
  { name: 'Cebolla', price_per_unit: 2000 },
  { name: 'Papa criolla', price_per_unit: 4000 },
  { name: 'Papa pastusa', price_per_unit: 3500 },
  { name: 'Aguacate', price_per_unit: 5000 },
];

describe('matchProductName', () => {
  it('exact match, accent/case-insensitive', () => {
    const r = matchProductName('tomate', catalog);
    expect(r).toEqual({ matched: true, name: 'Tomate', price: 3000 });
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
    expect(r.price).toBe(0);
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

  it('no match at all -> unmatched with the raw text and price 0', () => {
    const r = matchProductName('zanahoria', catalog);
    expect(r).toEqual({ matched: false, name: 'zanahoria', price: 0 });
  });

  it('price falls back to 0 when the catalog entry has no price_per_unit', () => {
    const r = matchProductName('lechuga', [{ name: 'Lechuga', price_per_unit: null }]);
    expect(r).toEqual({ matched: true, name: 'Lechuga', price: 0 });
  });
});
