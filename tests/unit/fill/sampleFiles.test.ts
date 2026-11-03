import { describe, expect, it } from 'vitest';
import { createSampleProfile, createSampleFiles } from '../../../src/schema';

function bytesOf(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
const ascii = (b: Uint8Array) => String.fromCharCode(...b);

describe('createSampleFiles', () => {
  const files = createSampleFiles();

  it('covers every attachment id of the sample resumes', () => {
    for (const r of createSampleProfile().resumes) {
      for (const id of Object.values(r.attachments)) expect(files[id as string], `${r.id}:${id}`).toBeDefined();
    }
  });

  it('uses the documented names and types', () => {
    expect(files['sample-resume-zh']).toMatchObject({ name: '林知远-简历.pdf', type: 'application/pdf' });
    expect(files['sample-resume-en']).toMatchObject({ name: 'Zhiyuan-Lin-Resume.pdf', type: 'application/pdf' });
    expect(files['sample-photo']).toMatchObject({ name: 'photo.png', type: 'image/png' });
  });

  it('PDF data has a valid header, trailer and xref offsets', () => {
    const text = ascii(bytesOf(files['sample-resume-en']!.dataUrl));
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    for (const m of text.matchAll(/(\d{10}) 00000 n /g)) {
      expect(text.slice(Number(m[1]), Number(m[1]) + 5)).toMatch(/^\d 0 o/);
    }
  });

  it('PNG data carries the PNG signature, IHDR and IEND', () => {
    const b = bytesOf(files['sample-photo']!.dataUrl);
    expect(Array.from(b.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(ascii(b.slice(12, 16))).toBe('IHDR');
    expect(ascii(b.slice(b.length - 8, b.length - 4))).toBe('IEND');
  });

  it('returns fresh objects on every call', () => {
    expect(createSampleFiles()).not.toBe(files);
    expect(createSampleFiles()).toEqual(files);
  });
});
