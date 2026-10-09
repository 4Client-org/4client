import { describe, it, expect } from 'vitest';
import { businessDateForInstant } from '../src/lib/businessDate.js';

// Bogotá no tiene horario de verano - UTC-5 todo el año.
function utcForBogota(dateStr: string, hour: number, minute: number, second: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour + 5, minute, second));
}
const ymd = (d: Date) => d.toISOString().split('T')[0];

describe('businessDateForInstant - corte de las 9 p.m. para el día del chat', () => {
  it('antes de las 9 p.m. cae en el mismo día', () => {
    expect(ymd(businessDateForInstant(utcForBogota('2026-03-10', 0, 0, 0)))).toBe('2026-03-10');
    expect(ymd(businessDateForInstant(utcForBogota('2026-03-10', 12, 0, 0)))).toBe('2026-03-10');
    expect(ymd(businessDateForInstant(utcForBogota('2026-03-10', 20, 59, 59)))).toBe('2026-03-10');
  });

  it('a las 9 p.m. en punto y después, cae en el día siguiente', () => {
    expect(ymd(businessDateForInstant(utcForBogota('2026-03-10', 21, 0, 0)))).toBe('2026-03-11');
    expect(ymd(businessDateForInstant(utcForBogota('2026-03-10', 22, 30, 0)))).toBe('2026-03-11');
    expect(ymd(businessDateForInstant(utcForBogota('2026-03-10', 23, 59, 59)))).toBe('2026-03-11');
  });

  it('a la medianoche en punto, ya es el día normal (el calendario cambió solo)', () => {
    expect(ymd(businessDateForInstant(utcForBogota('2026-03-11', 0, 0, 0)))).toBe('2026-03-11');
  });

  it('respeta el cambio de mes (31 de enero 9 p.m. -> 1 de febrero)', () => {
    expect(ymd(businessDateForInstant(utcForBogota('2026-01-31', 21, 0, 1)))).toBe('2026-02-01');
  });

  it('respeta el cambio de año (31 de diciembre 11:59:59 p.m. -> 1 de enero)', () => {
    expect(ymd(businessDateForInstant(utcForBogota('2026-12-31', 23, 59, 59)))).toBe('2027-01-01');
  });
});
