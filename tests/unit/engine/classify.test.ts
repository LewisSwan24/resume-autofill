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

  it('does not fall back to a key of another section: a second place under 基本信息 is not a school', () => {
    const s = scan(`<h3>基本信息</h3>${text('目前所在地', 'a')}${row('所在地点', '<select id="b"><option>深圳</option></select>', 'b')}`);
    expect(keys(s)).toEqual(['basics.currentLocation', null]);
  });

  it('falls back to the next candidate when the best key is taken', () => {
    // Both fields are labelled like a phone; the second is only a weak match for the other key.
    const s = scan(`<h3>基本信息</h3>${text('手机号码', 'a')}${text('手机号码(含区号)', 'b')}`);
    expect(keys(s)).toEqual(['contact.phone', 'contact.phoneFull']);
  });
});

describe('a full-time student now', () => {
  it.each(['是否为全日制在校学生（非全日制、非在校不可参加实习，请联系您的招聘HR）', '是否为全日制在校学生', '是否全日制在校生'])('%s', (ask) => {
    const s = scan(`<h3>申请信息</h3>${row(ask, '<select id="q"><option></option><option>是</option><option>否</option></select>', 'q')}`);
    expect(keys(s)).toEqual(['education.fullTimeStudent']);
    expect(s.cls[0]!.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
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

  describe('a form with no section headings, as most hosted forms are', () => {
    const fill = (s: Scanned, i: number) => {
      expect(s.cls[i]!.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
      return s.cls[i]!.fieldKey;
    };

    it('reads a bare label as the applicant once another field shows the form is about the applicant', () => {
      const s = scan(`${text('First Name', 'a')}${text('Last Name', 'b')}${text('Email', 'c')}${text('Phone', 'd')}${text('City', 'e')}`);
      expect(fill(s, 2)).toBe('contact.email');
      expect(fill(s, 3)).toBe('contact.phone');
      expect(fill(s, 4)).toBe('contact.addressCity');
    });

    it('reads three bare labels the same way, with nothing else to go on', () => {
      const s = scan(`${text('Full name', 'a')}${text('Email', 'b')}${text('Phone', 'c')}`);
      expect(fill(s, 0)).toBe('basics.fullName');
      expect(fill(s, 1)).toBe('contact.email');
      expect(fill(s, 2)).toBe('contact.phone');
    });

    it('counts a resume upload as showing whose form it is', () => {
      const s = scan(`${text('Name', 'a')}${text('Email', 'b')}${row('Resume', '<input id="c" type="file">', 'c')}`);
      expect(fill(s, 0)).toBe('basics.fullName');
      expect(fill(s, 1)).toBe('contact.email');
    });

    it.each(['Location (City)', 'Where are you currently located?', 'Current location', 'Where are you based?'])(
      '%j asks where you are based',
      (label) => {
        const s = scan(`${text('First Name', 'a')}${text('Last Name', 'b')}${text(label, 'c')}`);
        expect(fill(s, 2)).toBe('basics.currentLocation');
      },
    );

    it('reads common questions as what they ask', () => {
      const s = scan(`${text('Full name', 'a')}${text('Email', 'b')}${text('Phone', 'c')}
        ${text('Current company', 'd')}
        ${text('What is the highest level of tertiary education you have completed?', 'e')}`);
      expect(fill(s, 3)).toBe('work.company');
      expect(fill(s, 4)).toBe('education.degree');
    });

    it('still asks about one or two bare labels', () => {
      const s = scan(`${text('姓名', 'a')}${text('手机', 'b')}`);
      expect(s.cls[0]!.confidence).toBeLessThan(FILL_THRESHOLD);
      expect(s.cls[1]!.confidence).toBeLessThan(FILL_THRESHOLD);
    });

    it('leaves a labelled section to its own keys', () => {
      const s = scan(`${text('First Name', 'a')}${text('Last Name', 'b')}<h3>Emergency contact</h3>${text('Name', 'c')}${text('Phone', 'd')}`);
      expect(s.cls[2]!.fieldKey).toBe('emergencyContact.name');
      expect(s.cls[3]!.fieldKey).toBe('emergencyContact.phone');
    });
  });

  describe('answer buttons', () => {
    const buttons = '<button aria-pressed="false">Yes</button><button aria-pressed="false">No</button>';

    it('take the question beside them, and never the question of the block above', () => {
      const s = scan(`<div><p>Do you have the right to work</p>${buttons}</div><div><p>Do you consent to our privacy policy?</p>${buttons}</div><div><p>Do you consent to a background check?</p>${buttons}</div>`);
      expect(s.cls[2]!.fieldKey).toBeNull();
      expect(s.contexts).toHaveLength(3);
      expect(s.cls[0]!.fieldKey).toBe('workRights.hasFullWorkRights');
      expect(s.cls[1]!.fieldKey).toBeNull();
      expect(s.cls[1]!.reason).toBe('never_fill');
    });

    it('stay unnamed when the text before them is too long to be a label', () => {
      const long = 'I declare that everything in this application is true and complete. '.repeat(4);
      const s = scan(`<div><p>Do you have the right to work</p><div>${buttons}</div></div><div><p>${long}</p><div>${buttons}</div></div>`);
      expect(s.contexts[1]!.evidence.map((e) => e.text).join()).not.toContain('right to work');
      expect(s.cls[1]!.fieldKey).toBeNull();
    });
  });

  it('a combobox with no label does not borrow the label of the field above', () => {
    const s = scan(`${text('Email', 'a')}<div><button aria-haspopup="listbox">Choose</button></div>`);
    const combobox = s.contexts.find((c) => c.control.lib === 'aria')!;
    expect(combobox.evidence.map((e) => e.text)).not.toContain('Email');
  });

  describe('a heading that says the fields are about someone else', () => {
    const person = `${text('Name', 'c')}${text('Email', 'd')}${text('Phone', 'e')}`;

    it.each(['Who referred you?', 'Refer a friend', 'Person to notify', 'Your manager', 'Supervisor'])('%j keeps them in review', (heading) => {
      const s = scan(`${text('First name', 'a')}${text('Last name', 'b')}<h2>${heading}</h2>${person}`);
      for (const i of [2, 3, 4]) expect(s.cls[i]!.confidence, s.cls[i]!.fieldKey ?? '').toBeLessThan(FILL_THRESHOLD);
    });

    it.each(['Apply for this job', 'Submit your application', 'Application form', 'Your details', 'Senior AI Platform Engineer'])('%j is the applicant again', (heading) => {
      const s = scan(`<h2>${heading}</h2>${person}`);
      expect(s.cls[1]!.fieldKey).toBe('contact.email');
      expect(s.cls[1]!.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
    });
  });

  describe('an upload box the page reads to fill the form itself', () => {
    const file = (label: string, id: string) => row(label, `<input id="${id}" type="file">`, id);

    it.each(['Autofill from resume', 'Upload your resume to autofill', 'Auto-fill with resume', '上传简历自动解析', '简历解析'])(
      '%j is left alone even when it is the only upload box',
      (label) => {
        const s = scan(file(label, 'a'));
        expect(s.cls[0]!.fieldKey).toBeNull();
        expect(s.cls[0]!.reason).toBe('never_fill');
      },
    );

    it('a plain upload box is still the resume', () => {
      expect(scan(file('Resume/CV', 'a')).cls[0]!.fieldKey).toBe('attachments.resume');
      expect(scan(file('上传简历', 'a')).cls[0]!.fieldKey).toBe('attachments.resume');
    });

    it('the wording only counts on an upload box', () => {
      expect(scan(text('Autofill from resume', 'a')).cls[0]!.reason).not.toBe('never_fill');
    });
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
