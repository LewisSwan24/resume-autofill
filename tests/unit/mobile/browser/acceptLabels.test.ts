// The file chooser's 「这个网页要：…」 line names file kinds a person knows, not MIME types.
import { describe, expect, it } from 'vitest';
import { acceptLabels } from '../../../../mobile/app/src/browser/FileChooserSheet';
import { mt } from '../../../../mobile/app/src/i18n';

const zh = (accept: string[]) => acceptLabels(accept, (k) => mt('zh', k));
const en = (accept: string[]) => acceptLabels(accept, (k) => mt('en', k));

describe('acceptLabels', () => {
  it('folds a MIME type and its extension into one name', () => {
    expect(zh(['.pdf', 'application/pdf'])).toEqual(['PDF']);
    expect(zh(['application/pdf,.pdf'])).toEqual(['PDF']);
  });

  it('names images, Word and common picture types', () => {
    expect(zh(['image/*'])).toEqual(['图片']);
    expect(en(['image/*'])).toEqual(['Images']);
    expect(zh(['.doc', '.docx', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])).toEqual(['Word']);
    expect(zh(['image/jpeg', '.jpg', '.jpeg', 'image/png'])).toEqual(['JPG', 'PNG']);
  });

  it('falls back to the extension, or the short subtype, in capitals; a long unknown type stays as is', () => {
    expect(zh(['.zip'])).toEqual(['ZIP']);
    expect(zh(['text/plain'])).toEqual(['TXT']);
    expect(zh(['application/x-custom-thing'])).toEqual(['application/x-custom-thing']);
    expect(zh(['', ' '])).toEqual([]);
  });
});
