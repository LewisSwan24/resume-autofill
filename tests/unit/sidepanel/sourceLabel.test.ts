import { describe, expect, it } from 'vitest';
import { translate, type MessageKey } from '../../../src/i18n';
import { MODULES } from '../../../src/editor/modules';
import { describeSource } from '../../../entrypoints/sidepanel/sourceLabel';

const en = (key: MessageKey, params?: Record<string, string | number>) => translate('en', key, params);
const zh = (key: MessageKey, params?: Record<string, string | number>) => translate('zh', key, params);

describe('describeSource', () => {
  it('maps module + field paths to labels from the editor metadata', () => {
    expect(describeSource('basics.birthDate', en)).toBe('Basics › Date of birth');
    expect(describeSource('basics.gender', zh)).toBe('基本信息 › 性别');
    expect(describeSource('contact.email', en)).toBe('Contact › Email');
  });

  it('joins "a+b" derived sources with " + "', () => {
    expect(describeSource('basics.familyName+givenName', en)).toBe('Basics › Family name + Given name');
    expect(describeSource('basics.familyName+givenName', zh)).toBe('基本信息 › 姓 + 名');
    expect(describeSource('contact.phoneCountryCode+phone', en)).toBe('Contact › Country code + Phone');
  });

  it('numbers entries of repeatable modules from 1', () => {
    expect(describeSource('languages[0].language', en)).toBe('Languages 1 › Language');
    expect(describeSource('education[1].school', en)).toBe('Education 2 › School');
    expect(describeSource('education[1].endDate', zh)).toBe('教育经历 2 › 结束时间');
  });

  it('handles the address, attachments and top-level resume fields', () => {
    expect(describeSource('contact.address', en)).toBe('Contact › Address');
    expect(describeSource('contact.address.city', en)).toBe('Contact › City');
    expect(describeSource('attachments.photoFileId', en)).toBe('Attachments › Photo');
    expect(describeSource('attachments.resumeFileId', zh)).toBe('附件 › 简历文件 (PDF)');
    expect(describeSource('selfIntroduction', en)).toBe('About me › Self introduction');
  });

  it('returns null for paths the editor does not know', () => {
    expect(describeSource('nothing.known', en)).toBeNull();
    expect(describeSource('basics.notAField', en)).toBeNull();
    expect(describeSource('attachments.other', en)).toBeNull();
    expect(describeSource('', en)).toBeNull();
  });

  it('every editor field resolves to a non-empty label in both languages', () => {
    for (const module of MODULES) {
      for (const field of module.fields) {
        const path = module.repeatable ? `${module.module}[0].${field.key}` : `${module.module}.${field.key}`;
        for (const t of [en, zh]) {
          const label = describeSource(path, t);
          expect(label, path).toBeTruthy();
          expect(label, path).not.toContain('options.');
        }
      }
    }
  });
});
