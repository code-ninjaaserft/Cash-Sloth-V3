import { describe, expect, it } from 'vitest';
import { accentInk, accentHue, parseSavedColors, parsePreferences, resolveTheme } from './preferences.js';

describe('display preferences', () => {
  it('recovers safely from missing, malformed and unsupported saved settings', () => {
    for (const raw of [null, '{', 'null', '42', '{"theme":"blue","locale":"fr"}']) {
      expect(parsePreferences(raw)).toEqual({ theme: 'system', locale: 'en', accent: '#4f9271', savedColors: [] });
    }
    expect(parsePreferences('{"theme":"dark","locale":"de"}')).toEqual({ theme: 'dark', locale: 'de', accent: '#4f9271', savedColors: [] });
    expect(parsePreferences('{"theme":"light","locale":42}')).toEqual({ theme: 'light', locale: 'en', accent: '#4f9271', savedColors: [] });
  });
  it('follows the system only when selected', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

it('validates stored colors while preserving older preferences', () => {
  expect(parsePreferences('{"accent":"#ABCDEF"}').accent).toBe('#abcdef');
  for (const accent of ['red', '#fff', '#123456; color:red', null, 12]) {
    expect(parsePreferences(JSON.stringify({ accent })).accent).toBe('#4f9271');
  }
  expect(accentHue('#ff0000')).toBe(0);
  expect(accentHue('#00ff00')).toBe(120);
  expect(accentHue('#0000ff')).toBe(240);
  expect(accentHue('#ffffff')).toBe(0);
});

it('keeps only bounded embedded PNG logos and rejects external or active image references', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7XkAAAAASUVORK5CYII=';
  expect(parsePreferences(JSON.stringify({ customLogo: { name: 'Event.png', dataUrl } })).customLogo).toEqual({ name: 'Event.png', dataUrl });
  for (const invalid of [
    { name: 'External', dataUrl: 'https://example.com/logo.png' },
    { name: 'Active', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { name: 'Large', dataUrl: 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(1_500_000) },
    { name: '', dataUrl }, { name: 'Bad\0name', dataUrl },
  ]) expect(parsePreferences(JSON.stringify({ customLogo: invalid })).customLogo).toBeUndefined();
});

it('keeps named colors validated and unique, and picks readable ink for pure RGB presets', () => {
  expect(parseSavedColors([{ name: ' My yellow ', color: '#FFFF00' }, { name: 'my yellow', color: '#ff0000' }, { name: '', color: '#0000ff' }, { name: 'broken', color: 'red' }])).toEqual([{ name: 'My yellow', color: '#ffff00' }]);
  expect(accentInk('#ffff00')).toBe('#000000');
  expect(accentInk('#ff0000')).toBe('#000000');
  expect(accentInk('#0000ff')).toBe('#ffffff');
});
