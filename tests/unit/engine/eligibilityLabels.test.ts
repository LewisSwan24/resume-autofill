// Screening questions a job board asks before anything else: old enough to work, and allowed to stay. Both are
// worked out from the resume (birth date, work rights), so they are recognised like any other field.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILL_THRESHOLD } from '../../../src/engine/classify';
import { scanDocument } from '../../../src/engine/scan';

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  document.body.innerHTML = '';
});

/** One question on its own page, in Breezy's own markup: a heading, a note under it, the list two boxes down. */
const YES_NO = '<option value="? undefined:undefined ?"></option><option value="Yes">Yes</option><option value="No">No</option>';

function classify(ask: string, note = '') {
  document.body.innerHTML = `<ul><li class="question"><div class="dropdown">
    <h3><span>${ask}</span><span class="required" title="Required">*</span></h3>
    ${note ? `<div class="question-body"><p>${note}</p></div>` : ''}
    <div class="dropdown-container"><div class="select-wrapper">
      <select name="section_1653099388449_question_4" class="options-dropdown" required>${YES_NO}</select>
    </div></div>
  </div></li></ul>`;
  return scanDocument(document).classifications[0]!;
}

describe('screening questions', () => {
  it.each([
    ['Are you over 18 years?', 'If no, unfortunately we are unable to progress your application.'],
    ['Are you 18 years or older?', ''],
    ['Are you at least 18 years of age?', ''],
    ['是否年满18周岁？', ''],
  ])('%s → over 18', (ask, note) => {
    const c = classify(ask, note);
    expect(c.fieldKey).toBe('basics.isAdult');
    expect(c.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it.each([
    'Are you an Australian Citizen, Permanent Resident or a New Zealand Citizen?',
    'Are you an Australian citizen or permanent resident?',
    'Are you a citizen or permanent resident?',
  ])('%s → citizen or permanent resident', (ask) => {
    const c = classify(ask);
    expect(c.fieldKey).toBe('workRights.citizenOrResident');
    expect(c.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it.each([
    'Are you an Australian citizen?',
    'Are you a New Zealand citizen?',
    '是否为澳大利亚公民？',
  ])('%s asks about citizenship alone: a permanent resident would answer it differently', (ask) => {
    expect(classify(ask).fieldKey).not.toBe('workRights.citizenOrResident');
  });

  it.each(['Are you an Australian citizen?', 'Are you an Australian Citizen?', '是否为澳大利亚公民？'])('%s → citizen', (ask) => {
    const c = classify(ask);
    expect(c.fieldKey).toBe('workRights.citizen');
    expect(c.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('leaves another country’s citizenship alone: the work rights are for one country', () => {
    expect(classify('Are you a New Zealand citizen?').fieldKey).not.toBe('workRights.citizen');
  });

  it.each([
    ['Age', 'basics.age', '<input id="q" type="text">'],
    ['Citizenship', 'basics.nationality', '<input id="q" type="text">'],
    ['Citizenship status', 'workRights.status', '<input id="q" type="text">'],
    ['What are your working rights in Australia?', 'workRights.status', '<select id="q"><option></option><option>Australian citizen</option><option>Permanent resident</option><option>On a Working/Student Visa</option></select>'],
    ['Do you have full work rights in Australia?', 'workRights.hasFullWorkRights', '<select id="q"><option></option><option>Yes</option><option>No</option></select>'],
  ])('leaves %s to %s', (label, key, control) => {
    document.body.innerHTML = `<div><label for="q">${label}</label>${control}</div>`;
    expect(scanDocument(document).classifications[0]!.fieldKey).toBe(key);
  });
});

describe('the visa question', () => {
  /** Breezy's checkbox list: the box, then its name in a span, no label element. */
  const kinds = ['Student', 'Temporary Graduate', 'Work and Holiday', 'Skilled', 'Covid', 'Other'];
  const visaList = (n = 1) => `<li class="question"><div class="multiplechoice">
    <h3>What visa type do you currently hold?<span class="required" title="Required">*</span></h3>
    <ul class="options">${kinds.map((k) => `<li class="option"><input type="checkbox" required name="section_1653100621484_question_${n}"><span>${k}</span></li>`).join('')}</ul>
  </div></li>`;

  it('asks for the kind of visa, which the work-rights status answers when the page lists the kinds', () => {
    document.body.innerHTML = `<ul>${visaList()}</ul>`;
    const c = scanDocument(document).classifications[0]!;
    expect(c.fieldKey).toBe('workRights.status');
    expect(c.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('keeps the visa type itself in a box to type in', () => {
    document.body.innerHTML = '<div><label for="v">What visa type do you currently hold?</label><input id="v" type="text"></div>';
    expect(scanDocument(document).classifications[0]!.fieldKey).toBe('workRights.visaType');
  });

  it('leaves the work-rights status to the page question that asks for it', () => {
    document.body.innerHTML = `<div><label for="w">Work rights</label><select id="w"><option></option><option>Citizen</option><option>Temporary visa</option></select></div><ul>${visaList()}</ul>`;
    const [rights, visa] = scanDocument(document).classifications;
    expect(rights!.fieldKey).toBe('workRights.status');
    expect(visa!.fieldKey).not.toBe('workRights.status');
  });
});

describe('the working-rights question with its kinds listed (Teamtailor)', () => {
  it('is the work-rights status, sure enough to fill', () => {
    const kinds = ['Australian citizen', 'Permanent resident', 'On a Working/Student Visa', 'None of the above'];
    document.body.innerHTML = `<fieldset><legend>What are your working rights in Australia? <span>*</span> Required</legend>
      ${kinds.map((k, i) => `<label><input type="radio" name="wr" value="${i}">${k}</label>`).join('')}</fieldset>`;
    const c = scanDocument(document).classifications[0]!;
    expect(c.fieldKey).toBe('workRights.status');
    expect(c.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });
});
