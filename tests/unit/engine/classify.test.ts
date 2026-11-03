import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILL_THRESHOLD, REVIEW_THRESHOLD, classifyAll, classifySection, scoreField } from '../../../src/engine/classify';
import { scanDocument } from '../../../src/engine/scan';
import type { Classification, FieldContext } from '../../../src/engine/types';

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  document.body.innerHTML = '';
});

interface Scanned {
  contexts: FieldContext[];
  cls: Classification[];
}
function scan(html: string): Scanned {
  document.body.innerHTML = html;
  const r = scanDocument(document);
  return { contexts: r.contexts, cls: r.classifications };
}
/** field key per control, in document order */
const keys = (s: Scanned) => s.cls.map((c) => c.fieldKey);

const row = (label: string, control: string, id: string) => `<div><label for="${id}">${label}</label>${control}</div>`;
const text = (label: string, id: string) => row(label, `<input id="${id}" type="text">`, id);

describe('thresholds', () => {
  it('uses the plan constants', () => {
    expect(FILL_THRESHOLD).toBe(0.75);
    expect(REVIEW_THRESHOLD).toBe(0.5);
  });
});

describe('zh application form', () => {
  it('maps the common labels inside their sections', () => {
    const s = scan(`
      <h3>基本信息</h3>
      ${text('姓名', 'a')}${text('手机号码', 'b')}${text('电子邮箱', 'c')}
      <h3>教育经历</h3>
      ${text('毕业院校', 'd')}${text('专业', 'e')}
      ${row('学历', '<select id="f"><option value="">请选择</option><option>本科</option></select>', 'f')}
      ${row('入学时间', '<input id="g" type="month">', 'g')}${row('毕业时间', '<input id="h" type="month">', 'h')}
      ${row('政治面貌', '<select id="i"><option>群众</option></select>', 'i')}
    `);
    expect(keys(s)).toEqual([
      'basics.fullName', 'contact.phone', 'contact.email', 'education.school', 'education.major',
      'education.degree', 'education.startDate', 'education.endDate', 'basics.politicalStatus',
    ]);
    expect(s.cls.every((c) => c.confidence >= FILL_THRESHOLD)).toBe(true);
    expect(s.cls.slice(3, 8).every((c) => c.section === 'education')).toBe(true);
  });
});

describe('en application form', () => {
  it('maps the common labels', () => {
    const s = scan(`
      <fieldset><legend>Personal details</legend>
      ${text('First name', 'a')}${text('Last name', 'b')}${text('Preferred name', 'c')}
      ${row('Mobile', '<input id="d" type="tel">', 'd')}${text('Email', 'e')}
      </fieldset>
      <fieldset><legend>Work rights</legend>
      ${row('Work rights', '<select id="f"><option>Australian citizen</option></select>', 'f')}
      </fieldset>
      <fieldset><legend>Education</legend>
      ${text('Institution', 'g')}${text('Degree', 'h')}${row('Start date', '<input id="i" type="month">', 'i')}
      </fieldset>
    `);
    expect(keys(s)).toEqual([
      'basics.givenName', 'basics.familyName', 'basics.preferredName', 'contact.phone', 'contact.email',
      'workRights.status', 'education.school', 'education.degree', 'education.startDate',
    ]);
  });

  it('does not take "First name" for the full name (exclusion words)', () => {
    const s = scan(`<h3>Personal details</h3>${text('First name', 'a')}`);
    expect(s.cls[0]!.fieldKey).toBe('basics.givenName');
    expect(s.cls[0]!.candidates.map((c) => c.fieldKey)).not.toContain('basics.fullName');
  });
});

describe('never fill', () => {
  it('forces null with confidence 1 for captcha, password and consent controls', () => {
    const s = scan(`
      ${text('验证码', 'a')}${text('Password', 'b')}
      <label><input type="checkbox"> I agree to the privacy policy</label>
    `);
    for (const c of s.cls) expect(c).toMatchObject({ fieldKey: null, confidence: 1, reason: 'never_fill' });
  });
});

describe('global assignment', () => {
  it('maps confirm-email and email to contact.email (allowDuplicate)', () => {
    const s = scan(`<h3>联系方式</h3>${text('邮箱', 'a')}${text('确认邮箱', 'b')}`);
    expect(keys(s)).toEqual(['contact.email', 'contact.email']);
  });

  it('maps 学历 and 学位 of one card to education.degree', () => {
    const sel = (id: string) => `<select id="${id}"><option>本科</option></select>`;
    const s = scan(`<h3>教育经历</h3>${row('学历', sel('a'), 'a')}${row('学位', sel('b'), 'b')}`);
    expect(keys(s)).toEqual(['education.degree', 'education.degree']);
  });

  it('gives a key to one control per scope; the loser only gets a weaker, review-level guess', () => {
    const s = scan(`<h3>基本信息</h3>${text('姓名', 'a')}${text('姓名', 'b')}`);
    expect(keys(s).filter((k) => k === 'basics.fullName')).toHaveLength(1);
    const loser = s.cls.find((c) => c.fieldKey !== 'basics.fullName')!;
    expect(loser.confidence).toBeLessThan(FILL_THRESHOLD);
  });

  it('marks a control that lost every candidate as key_taken', () => {
    const s = scan(`<h3>基本信息</h3>${text('QQ', 'a')}${text('QQ', 'b')}`);
    const loser = s.cls.find((c) => c.fieldKey === null)!;
    expect(loser.reason).toBe('key_taken');
  });

  it('lets the same key repeat across repeated cards', () => {
    const card = (n: number) =>
      `<div class="card"><h4>教育经历 ${n}</h4>${text('学校', `s${n}`)}${text('专业', `m${n}`)}</div>`;
    const s = scan(`<section><h3>教育经历</h3>${card(1)}${card(2)}</section>`);
    expect(keys(s)).toEqual(['education.school', 'education.major', 'education.school', 'education.major']);
    expect(s.contexts.map((c) => c.group?.index)).toEqual([0, 0, 1, 1]);
  });

  it('falls back to the next candidate when the best key is taken', () => {
    // Both fields are labelled like a phone; the second is only a weak match for the other key.
    const s = scan(`<h3>基本信息</h3>${text('手机号码', 'a')}${text('手机号码(含区号)', 'b')}`);
    expect(keys(s)).toEqual(['contact.phone', 'contact.phoneFull']);
  });
});

describe('section context', () => {
  it('reads an ambiguous label ("时间") from the awards card', () => {
    const s = scan(`<h3>获奖情况</h3>${text('奖项名称', 'a')}${row('时间', '<input id="b" type="month">', 'b')}`);
    expect(keys(s)).toEqual(['awards.name', 'awards.date']);
  });

  it('separates 实习经历 from 工作经历', () => {
    const s = scan(`<h3>实习经历</h3>${text('公司名称', 'a')}<h3>工作经历</h3>${text('公司名称', 'b')}`);
    expect(s.cls.map((c) => c.section)).toEqual(['internship', 'work']);
    expect(keys(s)).toEqual(['work.company', 'work.company']);
  });

  it('infers the section from the field when the heading means nothing', () => {
    const s = scan(`<h3>Links</h3>${text('LinkedIn profile', 'a')}`);
    const sec = classifySection(s.contexts[0]!);
    expect(sec.section).toBe('contact');
    expect(s.cls[0]!.section).toBe('contact');
  });

  it('keeps a distinctive label in the wrong-looking section (About you → self introduction)', () => {
    const s = scan(`<h3>About you</h3><textarea aria-label="Tell us about yourself"></textarea>`);
    expect(s.cls[0]).toMatchObject({ fieldKey: 'misc.selfIntroduction', section: 'basics' });
    expect(s.cls[0]!.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('ignores a legend that only repeats the section title', () => {
    const s = scan(`<fieldset><legend>Preferences</legend>${row('Preferred location', '<select id="a"><option>Sydney</option></select>', 'a')}</fieldset>`);
    expect(s.cls[0]!.fieldKey).toBe('jobIntention.cities');
  });
});

describe('evidence weights and types', () => {
  it('puts placeholder-only evidence in the needs-review band', () => {
    const s = scan('<input placeholder="Email">');
    expect(s.cls[0]!.fieldKey).toBe('contact.email');
    expect(s.cls[0]!.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    expect(s.cls[0]!.confidence).toBeLessThan(FILL_THRESHOLD);
  });

  it('trusts a multi-word name attribute but not a vague one', () => {
    const s = scan('<input name="linkedin_url"><input name="url">');
    expect(s.cls[0]).toMatchObject({ fieldKey: 'contact.linkedin' });
    expect(s.cls[0]!.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
    expect(s.cls[1]!.confidence).toBeLessThan(FILL_THRESHOLD);
  });

  it('halves keys the control cannot hold (a text box named like an upload)', () => {
    const s = scan(`${text('Resume', 'a')}${row('Resume', '<input id="b" type="file">', 'b')}`);
    expect(s.cls[1]).toMatchObject({ fieldKey: 'attachments.resume' });
    expect(s.cls[1]!.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
    expect(s.cls[0]!.confidence).toBeLessThan(FILL_THRESHOLD);
  });

  it('maps a single checkbox to boolean keys only', () => {
    const s = scan(`<h3>实习经历</h3><label><input type="checkbox"> 至今</label>`);
    expect(s.cls[0]!.fieldKey).toBe('work.current');
  });

  it('flags ambiguous labels instead of guessing between sections', () => {
    const s = scan(`${text('姓名', 'a')}`);
    // No section: basics.fullName ties with family / emergency / referee names.
    expect(s.cls[0]!.confidence).toBeLessThan(FILL_THRESHOLD);
  });

  it('scoreField reports top candidates sorted by confidence', () => {
    const s = scan(`<h3>基本信息</h3>${text('邮箱', 'a')}`);
    const { candidates, neverFill } = scoreField(s.contexts[0]!, 'basics');
    expect(neverFill).toBe(false);
    expect(candidates[0]!.fieldKey).toBe('contact.email');
    expect(candidates.map((c) => c.confidence)).toEqual([...candidates.map((c) => c.confidence)].sort((a, b) => b - a));
  });

  it('classifyAll keeps the order and length of its input', () => {
    const s = scan(`${text('姓名', 'a')}${text('手机', 'b')}`);
    expect(classifyAll(s.contexts)).toHaveLength(2);
  });
});
