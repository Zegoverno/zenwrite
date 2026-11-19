import { describe, expect, it } from 'vitest';
import { headingFont, sizeOf, tokenAliases, zenOf } from './host.ts';

describe('tokenAliases', () => {
  it('points the page tokens at the host variables it was given', () => {
    const a = Object.fromEntries(tokenAliases({
      '--color-background-primary': '#fff', '--color-text-info': '#4a6', '--color-ring-primary': '#00f', '--border-radius-md': '10px', '--font-sans': 'Inter',
    }));
    expect(a['--paper']).toBe('var(--color-background-primary)');
    expect(a['--accent']).toBe('var(--color-text-info)');
    expect(a['--radius-md']).toBe('var(--border-radius-md)');
    expect(a['--sans']).toBe('var(--font-sans)');
    expect(a['--err']).toBeUndefined();
  });
  it('falls back to the ring colour for the accent', () => {
    expect(Object.fromEntries(tokenAliases({ '--color-ring-primary': '#00f' }))['--accent']).toBe('var(--color-ring-primary)');
  });
  it('does nothing without variables', () => {
    expect(tokenAliases(undefined)).toEqual([]);
  });
});

describe('zenOf', () => {
  it('keeps what it knows, including phone and the heading font', () => {
    expect(zenOf({ zen: { pane: 'side', path: 'a/B.md', mode: 'edit', slot: 'opener', phone: true, headingFont: '"Fraunces", serif' } }))
      .toEqual({ pane: 'side', path: 'a/B.md', mode: 'edit', slot: 'opener', phone: true, headingFont: '"Fraunces", serif' });
  });
  it('drops what it does not know', () => {
    expect(zenOf({ zen: { pane: 'moon', mode: 'x', phone: 'yes', headingFont: 'x; background: url(//e)' } }))
      .toEqual({ pane: undefined, path: null, mode: undefined, slot: undefined, phone: false, headingFont: undefined });
  });
  it('is undefined outside zenbot', () => {
    expect(zenOf({})).toBeUndefined();
    expect(zenOf(undefined)).toBeUndefined();
  });
});

describe('headingFont / sizeOf', () => {
  it('accepts a family list only', () => {
    expect(headingFont(' Fraunces, serif ')).toBe('Fraunces, serif');
    expect(headingFont('a{b}')).toBeUndefined();
    expect(headingFont('x'.repeat(300))).toBeUndefined();
  });
  it('reads usable sizes', () => {
    expect(sizeOf({ containerDimensions: { width: 640.4, height: 480 } })).toEqual({ width: 640, height: 480 });
    expect(sizeOf({ containerDimensions: { width: 0, height: 480 } })).toBeUndefined();
    expect(sizeOf({ containerDimensions: { maxWidth: 600 } })).toBeUndefined();
  });
});
