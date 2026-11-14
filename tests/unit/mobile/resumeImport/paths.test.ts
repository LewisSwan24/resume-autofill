// A draft path to where it lives in the editor: module, entry, field and label.
import { describe, expect, it } from 'vitest';
import { describePath } from '../../../../mobile/app/src/resumeImport/paths';

describe('describePath', () => {
  it('basics.familyName is the basics module with its field', () => {
    const info = describePath('basics.familyName')!;
    expect(info.module).toBe('basics');
    expect(info.meta.module).toBe('basics');
    expect(info.entry).toBeNull();
    expect(info.field?.key).toBe('familyName');
    expect(info.part).toBeNull();
    expect(info.labelKeys).toEqual(['options.field.familyName']);
    expect(info.hidden).toBe(false);
  });

  it('education.1.school is entry 1 of education', () => {
    const info = describePath('education.1.school')!;
    expect(info.module).toBe('education');
    expect(info.entry).toBe(1);
    expect(info.field?.key).toBe('school');
    expect(info.labelKeys).toEqual(['options.field.school']);
  });

  it('contact.address.city matches the address.city field', () => {
    const info = describePath('contact.address.city')!;
    expect(info.module).toBe('contact');
    expect(info.field?.key).toBe('address.city');
    expect(info.part).toBeNull();
    expect(info.labelKeys).toEqual(['options.field.city']);
  });

  it('basics.nativePlace.city is the nativePlace region, part city, with two label keys', () => {
    const info = describePath('basics.nativePlace.city')!;
    expect(info.module).toBe('basics');
    expect(info.field?.key).toBe('nativePlace');
    expect(info.field?.input).toBe('region');
    expect(info.part).toBe('city');
    expect(info.labelKeys).toEqual(['options.field.nativePlace', 'options.region.city']);
  });

  it('selfIntroduction is the about module', () => {
    const info = describePath('selfIntroduction')!;
    expect(info.module).toBe('about');
    expect(info.entry).toBeNull();
    expect(info.field?.key).toBe('selfIntroduction');
    expect(describePath('hobbies')?.module).toBe('about');
  });

  it('work.0.current and work.0.kind are hidden', () => {
    expect(describePath('work.0.current')).toMatchObject({ module: 'work', entry: 0, hidden: true });
    expect(describePath('work.0.kind')).toMatchObject({ module: 'work', entry: 0, hidden: true });
    expect(describePath('education.0.current')?.hidden).toBe(true);
    expect(describePath('work.0.company')?.hidden).toBe(false);
    // A skill's name shows the skills module's label, as the options page does.
    expect(describePath('skills.2.name')).toMatchObject({ module: 'skills', entry: 2, labelKeys: ['options.module.skills'] });
  });

  it('an unknown path is null', () => {
    for (const p of ['', 'name', 'location', 'nosuch.field', 'basics.nosuch', 'education.school', 'education.x.school', 'education.0', 'education.0.nosuch', 'basics.nativePlace.street', 'attachments.resumeFileId', 'contact.address']) {
      expect(describePath(p), p).toBeNull();
    }
  });
});
