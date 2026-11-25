// Labels written as a question to the applicant ("Can we get your first name, please?"), as on a live Breezy
// application: each asks for one thing, and that thing is filled as if it were the whole label.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILL_THRESHOLD } from '../../../src/engine/classify';
import { scanDocument } from '../../../src/engine/scan';

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  document.body.innerHTML = '';
});

/** One labelled control per question, each in its own block the way Breezy lays them out. */
function scan(questions: Array<[label: string, control?: string]>) {
  document.body.innerHTML = questions
    .map(([label, control], i) => `<div class="q"><h3><span>${label}</span></h3>${(control ?? '<input type="text">').replace('<input', `<input id="q${i}"`)}</div>`)
    .join('');
  document.querySelectorAll('h3').forEach((h, i) => h.setAttribute('id', `l${i}`));
  document.querySelectorAll('input').forEach((el, i) => el.setAttribute('aria-labelledby', `l${i}`));
  return scanDocument(document).classifications;
}

describe('question-style labels', () => {
  it('fills the Breezy contact questions', () => {
    const cls = scan([
      ["Let's get started! Can we get your first name, please?"],
      ['Thanks! What about your last name?'],
      ["What's your email address?", '<input type="email">'],
      ['How about your best contact phone number?', '<input type="tel">'],
    ]);
    expect(cls.map((c) => c.fieldKey)).toEqual(['basics.givenName', 'basics.familyName', 'contact.email', 'contact.phone']);
    for (const c of cls) expect(c.confidence, String(c.fieldKey)).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('fills a Breezy question whose privacy note sits between the question and the box', () => {
    // The shape of a live Breezy section, the company left out.
    const q = (n: number, ask: string, note = '', type = 'text') => `<li class="question"><div>
      <h3><span>${ask}</span><span class="required" title="Required">*</span></h3>
      ${note ? `<div class="question-body"><p>${note}</p></div>` : ''}
      <input required type="${type}" name="section_1_question_${n}">
      <div class="error-container" hidden><span class="error">A response is required</span></div></div></li>`;
    document.body.innerHTML = `<ul>
      ${q(0, "Let's get started! Can we get your first name, please?", 'Example Agency collects and handles your personal information in accordance with our Privacy Policy. You can view this on our website.')}
      ${q(1, 'Thanks! What about your last name?')}
      ${q(2, "What's your email address?", 'Please ensure you double check it is accurate because if it is not we will not be able to contact you.', 'email')}
      ${q(3, 'How about your best contact phone number?', '', 'tel')}
    </ul>`;
    const cls = scanDocument(document).classifications;
    expect(cls.map((c) => c.fieldKey)).toEqual(['basics.givenName', 'basics.familyName', 'contact.email', 'contact.phone']);
    for (const c of cls) expect(c.confidence, String(c.fieldKey)).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('fills where the applicant is based', () => {
    const [cls] = scan([['What city are you based in?']]);
    expect(cls!.fieldKey).toBe('basics.currentLocation');
    expect(cls!.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('fills Chinese questions to the applicant', () => {
    const cls = scan([['请输入您的手机号码', '<input type="tel">'], ['请填写你的邮箱']]);
    expect(cls.map((c) => c.fieldKey)).toEqual(['contact.phone', 'contact.email']);
    for (const c of cls) expect(c.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it("takes 'your' as the applicant: no tie with a family member's or a referee's phone or email", () => {
    const plain = scan([['手机号码', '<input type="tel">'], ['邮箱']]);
    expect(plain.every((c) => c.confidence < FILL_THRESHOLD), 'two bare labels alone do not say whose').toBe(true);
    const asked = scan([["What's your phone number?", '<input type="tel">'], ["What's your email?"]]);
    expect(asked.map((c) => c.fieldKey)).toEqual(['contact.phone', 'contact.email']);
    for (const c of asked) expect(c.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it("keeps someone else's field when the question names them", () => {
    document.body.innerHTML = `<h3>Referees</h3>
      <div><label for="r1">Referee name</label><input id="r1"></div>
      <div><label for="r2">What is your referee's email address?</label><input id="r2" type="email"></div>`;
    const cls = scanDocument(document).classifications;
    expect(cls[1]!.fieldKey).toBe('referees.email');
  });

  it('gives the name of the person who referred you to the referrer, never to the applicant', () => {
    const [c] = scan([['What is the full name of the person who referred you?']]);
    expect(c!.fieldKey).toBe('questions.referrerName');
  });

  it('leaves alone questions that ask for no field', () => {
    const cls = scan([
      ['What is the country of origin of your passport?'],
      ['Is there anything else you would like to tell us about your application?'],
    ]);
    for (const c of cls) {
      const filled = c.fieldKey !== null && c.confidence >= FILL_THRESHOLD;
      expect(filled, `${c.fieldKey} ${c.confidence}`).toBe(false);
    }
  });

  it('still ranks a plain label above the same words asked as a question', () => {
    // One page each: a page gives each field to one control only.
    const [plain] = scan([['First name']]);
    const [asked] = scan([['Can we get your first name, please?']]);
    expect(plain!.fieldKey).toBe('basics.givenName');
    expect(asked!.fieldKey).toBe('basics.givenName');
    expect(plain!.confidence).toBeGreaterThan(asked!.confidence);
  });
});
