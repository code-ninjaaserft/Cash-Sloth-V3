import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import branding from '../../assets/branding/manifest.json';

const brandingRoot = resolve('assets/branding');
const readAsset = (file: string): Buffer => readFileSync(resolve(brandingRoot, file));
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

describe('official branding assets', () => {
  it('preserves the original bytes and full-resolution dimensions', () => {
    const original = readAsset(branding.original.file);
    expect(createHash('sha256').update(original).digest('hex')).toBe(branding.original.sha256);
    expect(original.subarray(0, 8)).toEqual(pngSignature);
    expect(original.readUInt32BE(16)).toBe(branding.original.width);
    expect(original.readUInt32BE(20)).toBe(branding.original.height);
  });

  it('provides complete 32-bit PNG frames for Windows icon and DPI sizes', () => {
    const ico = readAsset(branding.files.windowsIcon);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(branding.windowsIconSizes.length);
    let expectedOffset = 6 + 16 * branding.windowsIconSizes.length;
    for (const [index, size] of branding.windowsIconSizes.entries()) {
      const entry = 6 + index * 16;
      expect(ico[entry] || 256).toBe(size);
      expect(ico[entry + 1] || 256).toBe(size);
      expect(ico.readUInt16LE(entry + 4)).toBe(1);
      expect(ico.readUInt16LE(entry + 6)).toBe(32);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset).toBe(expectedOffset);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      const png = ico.subarray(offset, offset + length);
      expect(png.subarray(0, 8)).toEqual(pngSignature);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
      expectedOffset += length;
    }
    expect(expectedOffset).toBe(ico.length);
  });

  it('keeps UI variants square, smaller than the original and identical to their ICO frames', () => {
    const ico = readAsset(branding.files.windowsIcon);
    for (const [size, file] of [[128, branding.files.uiPng], [256, branding.files.windowPng]] as const) {
      const png = readAsset(file);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
      expect(png.length).toBeLessThan(readAsset(branding.original.file).length);
      const entry = 6 + branding.windowsIconSizes.indexOf(size) * 16;
      const offset = ico.readUInt32LE(entry + 12);
      expect(png).toEqual(ico.subarray(offset, offset + ico.readUInt32LE(entry + 8)));
    }
  });
});
