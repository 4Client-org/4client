import { describe, it, expect } from 'vitest';
import { parseEnvBool } from '../src/lib/envBool.js';

describe('parseEnvBool (REQUIRE_2FA)', () => {
  it.each(['true', 'TRUE', 'True', '1', 'yes', 'on', ' true '])('%j -> true', (v) => {
    expect(parseEnvBool(v)).toBe(true);
  });
  it.each(['false', 'FALSE', 'False', '0', 'no', 'off', '', '  '])('%j -> false', (v) => {
    expect(parseEnvBool(v)).toBe(false);
  });
  it('ausente -> false', () => {
    expect(parseEnvBool(undefined)).toBe(false);
  });
  it('valor desconocido falla cerrado (true)', () => {
    expect(parseEnvBool('talvez')).toBe(true);
  });
});
