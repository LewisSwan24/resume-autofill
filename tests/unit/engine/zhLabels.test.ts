// The labels Chinese application forms use, simplified and traditional, and what each one must and must not become.
import { afterEach, describe, expect, it } from 'vitest';
import { FILL_THRESHOLD, REVIEW_THRESHOLD } from '../../../src/engine/classify';
import { scanDocument } from '../../../src/engine/scan';
import { normalizeLabel } from '../../../src/dictionary/normalize';

afterEach(() => {
  document.body.replaceChildren();
});

function read(label: string): { key: string | null; confidence: number; reason?: string | undefined } {
  document.body.replaceChildren();
  const form = document.createElement('form');
  for (const [id, text] of [['x', label], ['y', '占位其他']] as const) {
    const row = document.createElement('div');
    const caption = document.createElement('label');
    caption.htmlFor = id;
    caption.textContent = text;
    const input = document.createElement('input');
    input.id = id;
    input.type = 'text';
    row.append(caption, input);
    form.append(row);
  }
  document.body.append(form);
  const { contexts, classifications } = scanDocument(document);
  const c = classifications[contexts.findIndex((x) => (x.control.el as HTMLElement).id === 'x')];
  return { key: c?.fieldKey ?? null, confidence: c?.confidence ?? 0, reason: c?.reason };
}

describe('labels that mean the field they name', () => {
  it.each([
    ['姓名（中文）', 'basics.fullName'],
    ['真实姓名', 'basics.fullName'],
    ['英文姓名', 'basics.englishName'],
    ['联系方式', 'contact.phone'],
    ['手机号码', 'contact.phone'],
    ['邮箱地址', 'contact.email'],
    ['学校名称', 'education.school'],
    ['毕业院校', 'education.school'],
    ['专业名称', 'education.major'],
    ['最高学历', 'education.degree'],
    ['入学时间', 'education.startDate'],
    ['预计毕业时间', 'education.endDate'],
    ['公司名称', 'work.company'],
    ['实习单位', 'work.company'],
    ['岗位名称', 'work.position'],
    ['工作描述', 'work.description'],
    ['项目名称', 'projects.name'],
    ['获奖时间', 'awards.date'],
    ['证书名称', 'certificates.name'],
    ['期望城市', 'jobIntention.cities'],
    ['期望薪资', 'jobIntention.salaryMin'],
    ['可实习时间', 'jobIntention.availableFrom'],
    ['是否服从调剂', 'jobIntention.acceptAdjustment'],
    ['校内职务', 'campus.role'],
    ['自我评价', 'misc.selfIntroduction'],
    ['招聘信息来源', 'jobIntention.howDidYouHear'],
    ['成绩单', 'attachments.transcript'],
  ])('%s is %s', (label, key) => {
    expect(read(label).key).toBe(key);
  });
});

describe('labels about something else that merely start with a field’s name', () => {
  // Chinese puts what a phrase is about at its end: 公司规模 is a size, not a company.
  it.each([
    ['公司规模', 'company'],
    ['公司性质', 'company'],
    ['公司地址', 'company'],
    ['户籍类型', 'household'],
    ['专业类别', 'major'],
    ['专业排名方式', 'major'],
    ['工作年限', 'work.'],
    ['工作经验', 'work.'],
    ['职位类别', 'position'],
    ['学校类型', 'school'],
    ['学校所在地', 'school'],
    ['证件照', 'idNumber'],
    ['证件有效期', 'idNumber'],
    ['成绩单', 'gpa'],
    ['是否有海外经历', 'disability'],
    ['求职信', 'jobIntention.positions'],
    ['曾用名', 'preferredName'],
    ['备用手机', 'contact.phone'],
    ['研究方向', 'thesis'],
    ['成员工作单位', 'work.company'],
  ])('%s is not taken for %s', (label, wrong) => {
    expect(read(label).key ?? '').not.toContain(wrong);
  });

  it.each(['公司规模', '公司性质', '户籍类型', '专业类别', '工作年限', '工作经验', '职位类别', '学校类型'])('%s fills nothing and asks nothing', (label) => {
    const { key, confidence } = read(label);
    expect(key === null || confidence < REVIEW_THRESHOLD, `${label}: ${key} ${confidence}`).toBe(true);
  });

  it('asks nothing of a span of dates with no part of the file around it', () => {
    for (const label of ['起止时间', '在职时间']) expect(read(label).confidence).toBeLessThan(FILL_THRESHOLD);
  });

  it('keeps bilingual labels, where the other language is no new subject', () => {
    expect(read('电子邮箱 Email').key).toBe('contact.email');
    expect(read('姓名 Name').key).toBe('basics.fullName');
  });
});

describe('traditional characters', () => {
  it.each([
    ['姓名', 'basics.fullName'],
    ['電話', 'contact.phone'],
    ['聯絡電話', 'contact.phone'],
    ['手機號碼', 'contact.phone'],
    ['電子郵箱', 'contact.email'],
    ['電郵', 'contact.email'],
    ['性別', 'basics.gender'],
    ['婚姻狀況', 'basics.maritalStatus'],
    ['籍貫', 'basics.nativePlace'],
    ['現居地', 'basics.currentLocation'],
    ['通訊地址', 'contact.addressFull'],
    ['學校名稱', 'education.school'],
    ['畢業院校', 'education.school'],
    ['專業', 'education.major'],
    ['學歷', 'education.degree'],
    ['入學時間', 'education.startDate'],
    ['畢業時間', 'education.endDate'],
    ['公司名稱', 'work.company'],
    ['職位名稱', 'work.position'],
    ['工作內容', 'work.description'],
    ['項目名稱', 'projects.name'],
    ['專案名稱', 'projects.name'],
    ['獎項名稱', 'awards.name'],
    ['證書名稱', 'certificates.name'],
    ['自我評價', 'misc.selfIntroduction'],
    ['期望薪資', 'jobIntention.salaryMin'],
    ['到職時間', 'jobIntention.availableFrom'],
    ['緊急聯絡人', 'emergencyContact.name'],
  ])('%s is %s', (label, key) => {
    expect(read(label).key).toBe(key);
  });

  it.each(['驗證碼', '圖形驗證碼', '密碼', '確認密碼', '本人聲明以上資料屬實', '我已閱讀並同意隱私政策', '同意授權'])('%s is never filled', (label) => {
    const { key, reason } = read(label);
    expect(key === null && reason === 'never_fill', `${label}: ${key} ${reason}`).toBe(true);
  });

  it('reads a request to fill something in as the same noise', () => {
    expect(normalizeLabel('請輸入電話')).toBe(normalizeLabel('请输入电话'));
  });

  it('changes no characters outside Chinese', () => {
    expect(normalizeLabel('Résumé 2026 スキル')).toBe('resume 2026 スキル');
  });
});
