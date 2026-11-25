// jsdom stand-ins for the three synthetic fixture pages (fixtures/synthetic/*).
// - native: the real index.html / frame.html (scripts removed, employment cards rebuilt like main.ts does).
// - antd / Element Plus: hand-written DOM with the quirks of the real libraries (see comments per builder).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../fixtures/synthetic');

function bodyOf(file: string): string {
  const doc = new DOMParser().parseFromString(readFileSync(resolve(ROOT, file), 'utf8'), 'text/html');
  doc.querySelectorAll('script, iframe').forEach((n) => n.remove());
  return doc.body.innerHTML;
}

// ---------------------------------------------------------------------------------------------- native

/** Mirrors addEmploymentCard() in fixtures/synthetic/native/main.ts. */
function employmentCard(n: number): string {
  const row = (id: string, text: string, control: string) =>
    `<div class="row"><label for="${id}">${text}</label>${control}</div>`;
  const base = n * 10;
  return `<div class="card"><h3>Employment ${n}</h3>
    ${row(`emp-${base + 1}`, 'Job title', `<input id="emp-${base + 1}" type="text" autocomplete="off">`)}
    ${row(`emp-${base + 2}`, 'Company', `<input id="emp-${base + 2}" type="text" autocomplete="off">`)}
    ${row(`emp-${base + 3}`, 'Start', `<input id="emp-${base + 3}" type="month" autocomplete="off">`)}
    ${row(`emp-${base + 4}`, 'End', `<input id="emp-${base + 4}" type="month" autocomplete="off">`)}
    <div class="row"><label><input type="checkbox"> I currently work here</label></div>
    ${row(`emp-${base + 5}`, 'Description', `<textarea id="emp-${base + 5}" rows="3"></textarea>`)}
  </div>`;
}

/** The native fixture page with `employmentCards` employment cards ("+ Add another" clicked n-1 times). */
export function mountNative(employmentCards = 2): void {
  document.body.innerHTML = bodyOf('native/index.html');
  const list = document.querySelector('#employment-list')!;
  list.innerHTML = Array.from({ length: employmentCards }, (_, i) => employmentCard(i + 1)).join('');
}

/** An application-question page (questions-zh / questions-en), as served: plain controls, no script needed to scan. */
export function mountQuestions(lang: 'zh' | 'en'): void {
  document.body.innerHTML = bodyOf(`questions-${lang}/index.html`);
}

/** Language levels asked apart and a works card (languages-works), as served. */
export function mountLanguagesWorks(): void {
  document.body.innerHTML = bodyOf('languages-works/index.html');
}

/** The same-origin iframe document of the native fixture (own frame → own scan). */
export function mountNativeFrame(): void {
  document.body.innerHTML = bodyOf('native/frame.html');
}

// ---------------------------------------------------------------------------------------------- antd v5

const antd = {
  /** Form.Item: label[for=<inner input id>] inside .ant-form-item-label. */
  item(label: string | null, inner: string, forId = ''): string {
    const lab = label
      ? `<div class="ant-col ant-form-item-label"><label for="${forId}" title="${label}">${label}</label></div>`
      : '';
    return `<div class="ant-form-item"><div class="ant-row ant-form-item-row">${lab}<div class="ant-col ant-form-item-control"><div class="ant-form-item-control-input"><div class="ant-form-item-control-input-content">${inner}</div></div></div></div></div>`;
  },
  input: (id: string, placeholder: string) => `<input id="${id}" class="ant-input" type="text" placeholder="${placeholder}">`,
  textarea: (id: string, placeholder: string) => `<textarea id="${id}" class="ant-input" placeholder="${placeholder}"></textarea>`,
  select(id: string, placeholder = '请选择', multiple = false): string {
    return `<div class="ant-select ant-select-${multiple ? 'multiple' : 'single'}"><div class="ant-select-selector"><span class="ant-select-selection-search"><input id="${id}" class="ant-select-selection-search-input" role="combobox" type="search" autocomplete="off"></span><span class="ant-select-selection-placeholder">${placeholder}</span></div></div>`;
  },
  /** antd v5 Cascader root is .ant-select.ant-cascader. */
  cascader(id: string): string {
    return `<div class="ant-select ant-cascader ant-select-single"><div class="ant-select-selector"><span class="ant-select-selection-search"><input id="${id}" class="ant-select-selection-search-input" role="combobox" type="search" autocomplete="off" readonly></span><span class="ant-select-selection-placeholder">请选择</span></div></div>`;
  },
  picker(id: string, granularity: 'day' | 'month'): string {
    const [placeholder, size] = granularity === 'month' ? ['请选择月份', 7] : ['请选择日期', 12];
    return `<div class="ant-picker"><div class="ant-picker-input"><input id="${id}" placeholder="${placeholder}" size="${size}" autocomplete="off"></div></div>`;
  },
  radioGroup(id: string, labels: string[]): string {
    const radio = (l: string) =>
      `<label class="ant-radio-wrapper"><span class="ant-radio"><input class="ant-radio-input" type="radio" value="${l}"><span class="ant-radio-inner"></span></span><span>${l}</span></label>`;
    return `<div class="ant-radio-group ant-radio-group-outline" id="${id}">${labels.map(radio).join('')}</div>`;
  },
  /** Form.Item without label wrapping a <Checkbox>text</Checkbox>. */
  checkbox: (id: string, text: string) =>
    `<label class="ant-checkbox-wrapper"><span class="ant-checkbox"><input type="checkbox" class="ant-checkbox-input" id="${id}"></span><span>${text}</span></label>`,
  upload: () =>
    `<span class="ant-upload-wrapper"><div class="ant-upload ant-upload-select"><span class="ant-upload" role="button"><input type="file" accept=".pdf,.doc,.docx" style="display:none"><button type="button" class="ant-btn"><span>点击上传</span></button></span></div></span>`,
  /** Input with a Select as addonBefore (nested Form.Item noStyle, no label of its own). */
  phone: (id: string, ccId: string) =>
    `<span class="ant-input-group-wrapper"><span class="ant-input-wrapper ant-input-group"><span class="ant-input-group-addon">${antd.select(ccId, '区号')}</span><input id="${id}" class="ant-input" type="text" placeholder="请输入手机号码"></span></span>`,
  card: (title: string, body: string, inner = false) =>
    `<div class="ant-card ant-card-bordered${inner ? ' ant-card-type-inner' : ''}"><div class="ant-card-head"><div class="ant-card-head-wrapper"><div class="ant-card-head-title">${title}</div></div></div><div class="ant-card-body">${body}</div></div>`,
  addButton: (text: string) => `<button type="button" class="ant-btn ant-btn-dashed ant-btn-block"><span>${text}</span></button>`,
};

/** The antd fixture (fixtures/synthetic/antd/App.tsx) in its initial state: 1 education, 2 internship, 1 award card. */
export function mountAntd(): void {
  const f = (name: string) => `application_${name}`;
  const item = (label: string, name: string, inner: string) => antd.item(label, inner, f(name));
  const entry = (title: string, body: string) => antd.card(title, body, true);

  const education = (i: number) =>
    entry(
      `教育经历 ${i + 1}`,
      [
        item('学校名称', `education_${i}_school`, antd.select(f(`education_${i}_school`))),
        item('学历', `education_${i}_degree`, antd.select(f(`education_${i}_degree`))),
        item('专业', `education_${i}_major`, antd.input(f(`education_${i}_major`), '请输入专业')),
        item('入学时间', `education_${i}_startDate`, antd.picker(f(`education_${i}_startDate`), 'month')),
        item('毕业时间', `education_${i}_endDate`, antd.picker(f(`education_${i}_endDate`), 'month')),
        item('GPA', `education_${i}_gpa`, antd.input(f(`education_${i}_gpa`), '请输入GPA')),
        item('专业排名', `education_${i}_ranking`, antd.input(f(`education_${i}_ranking`), '如 5/120')),
      ].join(''),
    );
  const internship = (i: number) =>
    entry(
      `实习经历 ${i + 1}`,
      [
        item('公司名称', `internship_${i}_company`, antd.input(f(`internship_${i}_company`), '请输入公司名称')),
        item('职位名称', `internship_${i}_position`, antd.input(f(`internship_${i}_position`), '请输入职位名称')),
        item('开始时间', `internship_${i}_startDate`, antd.picker(f(`internship_${i}_startDate`), 'month')),
        item('结束时间', `internship_${i}_endDate`, antd.picker(f(`internship_${i}_endDate`), 'month')),
        antd.item(null, antd.checkbox(f(`internship_${i}_current`), '至今')),
        item('工作内容', `internship_${i}_description`, antd.textarea(f(`internship_${i}_description`), '请描述工作内容')),
      ].join(''),
    );
  const award = (i: number) =>
    entry(
      `获奖情况 ${i + 1}`,
      [
        item('奖项名称', `award_${i}_name`, antd.input(f(`award_${i}_name`), '请输入奖项名称')),
        item('获奖时间', `award_${i}_date`, antd.picker(f(`award_${i}_date`), 'month')),
        item('奖项级别', `award_${i}_level`, antd.select(f(`award_${i}_level`))),
      ].join(''),
    );

  document.body.innerHTML = `<div><h1>校园招聘 · 简历投递</h1><form class="ant-form ant-form-vertical" id="application">
    ${antd.card(
      '基本信息',
      [
        item('姓名', 'name', antd.input(f('name'), '请输入姓名')),
        item('性别', 'gender', antd.radioGroup(f('gender'), ['男', '女'])),
        item('出生日期', 'birthDate', antd.picker(f('birthDate'), 'day')),
        item('民族', 'ethnicity', antd.select(f('ethnicity'))),
        item('政治面貌', 'politicalStatus', antd.select(f('politicalStatus'))),
        item('手机号码', 'phone', antd.phone(f('phone'), f('phoneCountryCode'))),
        item('电子邮箱', 'email', antd.input(f('email'), '请输入电子邮箱')),
        item('身份证号', 'idNumber', antd.input(f('idNumber'), '请输入身份证号')),
        item('微信号', 'wechat', antd.input(f('wechat'), '请输入微信号')),
        item('QQ', 'qq', antd.input(f('qq'), '请输入QQ号')),
        item('籍贯', 'nativePlace', antd.cascader(f('nativePlace'))),
        item('现居住地', 'currentLocation', antd.cascader(f('currentLocation'))),
      ].join(''),
    )}
    ${antd.card(
      '求职意向',
      [
        item('期望职位', 'expectedPosition', antd.input(f('expectedPosition'), '请输入期望职位')),
        item('期望城市', 'expectedCities', antd.select(f('expectedCities'), '请选择', true)),
        item('是否服从调剂', 'acceptAdjustment', antd.radioGroup(f('acceptAdjustment'), ['是', '否'])),
      ].join(''),
    )}
    ${antd.card('教育经历', education(0) + antd.addButton('+ 添加教育经历'))}
    ${antd.card('实习经历', internship(0) + internship(1))}
    ${antd.card(
      '语言能力',
      item('英语等级', 'englishLevel', antd.select(f('englishLevel'))) +
        item('外语语种', 'foreignLanguage', antd.select(f('foreignLanguage'))),
    )}
    ${antd.card('获奖情况', award(0))}
    ${antd.card('附件', antd.item('上传简历', antd.upload(), f('resume')))}
    ${antd.card('自我评价', item('自我评价', 'selfEvaluation', antd.textarea(f('selfEvaluation'), '请输入自我评价')))}
    ${antd.card('其他', item('推荐人工号', 'referrerId', antd.input(f('referrerId'), '如无请留空')))}
    <button type="submit" class="ant-btn ant-btn-primary"><span>提交申请</span></button>
  </form></div>`;
}

/** The same page with `n` education cards (the add button clicked n-1 times). */
export function antdEducationCards(n: number): string {
  const one = (i: number) =>
    antd.card(
      `教育经历 ${i + 1}`,
      [
        antd.item('学校名称', antd.select(`e${i}s`), `e${i}s`),
        antd.item('学历', antd.select(`e${i}d`), `e${i}d`),
        antd.item('专业', antd.input(`e${i}m`, '请输入专业'), `e${i}m`),
      ].join(''),
      true,
    );
  return antd.card('教育经历', Array.from({ length: n }, (_, i) => one(i)).join('') + antd.addButton('+ 添加教育经历'));
}

// ---------------------------------------------------------------------------------------------- Element Plus

const el = {
  /** el-form-item with a [for]-bound label (input, select, picker, cascader, textarea). */
  item(label: string, id: string, inner: string): string {
    return `<div class="el-form-item"><label id="${id}-l" for="${id}" class="el-form-item__label" style="width:120px">${label}</label><div class="el-form-item__content">${inner}</div></div>`;
  },
  /** Radio group / checkbox / upload items have no [for]: role=group + aria-labelledby on the item. */
  groupItem(label: string, id: string, inner: string): string {
    return `<div class="el-form-item" role="group" aria-labelledby="${id}"><label id="${id}" class="el-form-item__label" style="width:120px">${label}</label><div class="el-form-item__content">${inner}</div></div>`;
  },
  input: (id: string) => `<div class="el-input el-input--default"><div class="el-input__wrapper"><input class="el-input__inner" type="text" autocomplete="off" id="${id}"></div></div>`,
  textarea: (id: string) => `<div class="el-textarea"><textarea class="el-textarea__inner" id="${id}"></textarea></div>`,
  select: (id: string, placeholder = '请选择') =>
    `<div class="el-select"><div class="el-select__wrapper"><div class="el-select__selection"><div class="el-select__selected-item el-select__placeholder is-transparent"><span>${placeholder}</span></div><div class="el-select__input-wrapper"><input type="text" class="el-select__input" role="combobox" readonly id="${id}"></div></div></div></div>`,
  month: (id: string) =>
    `<div class="el-date-editor el-date-editor--month"><div class="el-input el-input--default"><div class="el-input__wrapper"><input class="el-input__inner" type="text" placeholder="选择月" id="${id}"></div></div></div>`,
  cascader: (id: string) =>
    `<div class="el-cascader"><div class="el-input"><div class="el-input__wrapper"><input class="el-input__inner" type="text" readonly placeholder="请选择" id="${id}"></div></div></div>`,
  radioGroup(labels: string[]): string {
    const radio = (l: string) =>
      `<label class="el-radio"><span class="el-radio__input"><input class="el-radio__original" type="radio" value="${l}"><span class="el-radio__inner"></span></span><span class="el-radio__label">${l}</span></label>`;
    return `<div class="el-radio-group" role="radiogroup">${labels.map(radio).join('')}</div>`;
  },
  checkbox: (text: string) =>
    `<label class="el-checkbox"><span class="el-checkbox__input"><input class="el-checkbox__original" type="checkbox" value=""><span class="el-checkbox__inner"></span></span><span class="el-checkbox__label"><span>${text}</span></span></label>`,
  upload: () =>
    `<div class="el-upload el-upload--text"><button type="button" class="el-button"><span>选择照片</span></button><input class="el-upload__input" type="file" name="file" accept="image/*"></div><ul class="el-upload-list"></ul>`,
  card: (title: string, body: string, inner = false) =>
    `<div class="el-card ${inner ? 'is-never-shadow' : 'is-always-shadow'}"><div class="el-card__header">${title}</div><div class="el-card__body">${body}</div></div>`,
  button: (text: string) => `<button type="button" class="el-button"><span>${text}</span></button>`,
};

/**
 * The Element Plus fixture (fixtures/synthetic/element/App.vue): 2 education cards, `internshipCards` internship
 * cards (the page starts with 0 and "添加实习经历" appends), 1 project card, a 2-row family table.
 */
export function mountElement(internshipCards = 1): void {
  let n = 0;
  const id = () => `el-id-${++n}`;
  const text = (label: string) => {
    const i = id();
    return el.item(label, i, el.input(i));
  };
  const select = (label: string, ph?: string) => {
    const i = id();
    return el.item(label, i, el.select(i, ph));
  };
  const month = (label: string) => {
    const i = id();
    return el.item(label, i, el.month(i));
  };
  const area = (label: string) => {
    const i = id();
    return el.item(label, i, el.textarea(i));
  };
  const cascader = (label: string) => {
    const i = id();
    return el.item(label, i, el.cascader(i));
  };
  const group = (label: string, inner: string) => el.groupItem(label, id(), inner);

  const education = (i: number) =>
    el.card(
      `教育经历 ${i + 1}`,
      [select('学校', '请输入学校名称'), select('学历'), select('学位'), text('专业'), month('开始时间'), month('结束时间')].join(''),
      true,
    );
  const internship = (i: number) =>
    el.card(
      `实习经历 ${i + 1}`,
      [
        text('公司'),
        text('岗位'),
        month('开始时间'),
        month('结束时间'),
        group('是否在职', el.checkbox('是')),
        area('工作描述'),
      ].join(''),
      true,
    );
  const project = el.card('项目经历 1', [text('项目名称'), text('担任角色'), area('项目描述')].join(''), true);
  const cell = () => `<td>${el.input(id())}</td>`;
  const familyRow = `<tr>${cell()}${cell()}${cell()}${cell()}</tr>`;

  document.body.innerHTML = `<div><h2>校园招聘网申表</h2><form class="el-form">
    ${el.card(
      '基本信息',
      [
        text('姓名'),
        group('性别', el.radioGroup(['男', '女'])),
        month('出生年月'),
        select('政治面貌'),
        select('婚姻状况'),
        text('手机'),
        text('邮箱'),
        cascader('户口所在地'),
        cascader('生源地'),
      ].join(''),
    )}
    ${el.card('教育经历', education(0) + education(1))}
    ${el.card(
      '实习经历',
      Array.from({ length: internshipCards }, (_, i) => internship(i)).join('') + el.button('添加实习经历'),
    )}
    ${el.card('项目经历', project)}
    ${el.card(
      '家庭成员',
      `<table class="family-table"><thead><tr><th>关系</th><th>姓名</th><th>工作单位</th><th>职务</th></tr></thead><tbody>${familyRow}${familyRow}</tbody></table>`,
    )}
    ${el.card('紧急联系人', text('姓名') + text('电话'))}
    ${el.card(
      '其他信息',
      group('是否接受外派', el.checkbox('是')) + group('照片', el.upload()) + area('自我介绍'),
    )}
  </form></div>`;
}
