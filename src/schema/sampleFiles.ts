// Tiny valid sample attachments for the sample resumes (fixtures, tests, the options page "try it" flow).
import type { FileData } from '../drivers/types';

const textBytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** One-page blank PDF with a correct xref table (generated, so offsets always match). */
export function createTinyPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return textBytes(body);
}

/** 1×1 transparent PNG. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Files keyed by the sample attachment ids (`attachments.*FileId` of `createSampleProfile()`). */
export function createSampleFiles(): Record<string, FileData> {
  const pdf = `data:application/pdf;base64,${toBase64(createTinyPdf())}`;
  return {
    'sample-resume-zh': { name: '林知远-简历.pdf', type: 'application/pdf', dataUrl: pdf },
    'sample-resume-en': { name: 'Zhiyuan-Lin-Resume.pdf', type: 'application/pdf', dataUrl: pdf },
    'sample-photo': { name: 'photo.png', type: 'image/png', dataUrl: `data:image/png;base64,${PNG_BASE64}` },
  };
}
