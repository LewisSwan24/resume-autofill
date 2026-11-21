// The shape of a real Beisen (北森, zhiye.com) resume form: its Phoenix widgets with the classes the page has, the
// questions in the order it asks them. Section titles carry only build-hashed classes, as on the page.

const INPUT = (placeholder = '请输入') =>
  `<div class="phoenix-input"><input class="phoenix-input__input phoenix-input__input--sizeLarge" type="text" placeholder="${placeholder}" spellcheck="false" value=""><span class="phoenix-input__clear phoenix-input__clear--hide"></span></div>`;

const TEXTAREA = '<div class="phoenix-textarea"><textarea class="phoenix-textarea__textarea" placeholder="请输入"></textarea></div>';

const ARROW = '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"></path></svg>';
const CALENDAR =
  '<svg viewBox="0 0 16 16"><defs><path id="prefix__a_field_date_time_picker" d="M0 0h16v16H0z"></path></defs><use xlink:href="#prefix__a_field_date_time_picker"></use></svg>';

const layer = (inner: string) =>
  `<div class="phoenix-unmodeled-layer phoenix-unmodeled-layer--block"><div class="phoenix-unmodeled-layer__inner"><div class="phoenix-unmodeled-layer__protect"><div class="phoenix-unmodeled-layer__content phoenix-unmodeled-layer__content--block">${inner}</div></div></div></div>`;

export const beisenSelect = (icon: string = ARROW, multi = false) =>
  layer(
    `<div class="phoenix-select phoenix-select--editable phoenix-select--borderColorable${multi ? ' phoenix-select--multi' : ''} phoenix-select--large">` +
      '<span class="phoenix-select__calcEle"></span>' +
      '<div class="phoenix-select__placeHolder phoenix-select__placeHolder--large phoenix-select__placeHolder--show">请选择</div>' +
      '<ul class="phoenix-select__content"><li class="phoenix-select__inputWrapper phoenix-select__inputWrapper--emptyMultiValue">' +
      '<input placeholder="" class="phoenix-select__input phoenix-select__input--large phoenix-select__input--unText" value=""></li></ul>' +
      `<div class="phoenix-select__switchArrow">${icon}</div><div class="phoenix-select__clearIcon"></div></div>`,
  );

const SELECT = beisenSelect();
const DATE = beisenSelect(CALENDAR);
/** A box that takes several answers, shown as tags. */
const MULTI = beisenSelect(ARROW, true);

export const beisenRadios = (labels: string[]) =>
  `<div class="phoenix-radio-group">${labels
    .map(
      (l) =>
        `<div class="phoenix-radio-group__radioItem"><div class="phoenix-radio phoenix-radio--withLabel phoenix-radio-group__radio"><div class="phoenix-radio__wrapper"><div class="phoenix-radio__circle-wrapper"><div class="phoenix-radio__circle"></div><div class="phoenix-radio__dot"></div></div><span class="phoenix-radio__radio-text phoenix-radio__radio-text--appear">${l}</span></div></div></div>`,
    )
    .join('')}</div>`;

/** A button that picks what kind of number follows, beside the number itself. */
const WITH_TYPE = (type: string, placeholder: string) =>
  `<div class="sc-aBcDe fGhIj"><div class="mobile-container false "><div class="sc-dvQaRk idXehy">${layer(
    `<div class="phoenix-button mobile-type-button"><div class="phoenix-button__wraper phoenix-button__wraper--big phoenix-button__wraper--normal"><div class="phoenix-button__content">${type}<span class="phoenix-button__suffixIcon"></span></div></div></div>`,
  )}${INPUT(placeholder).replace('phoenix-input__input--sizeLarge', 'phoenix-input__input--sizeLarge phoenix-input__input--noEllipsis')}</div></div></div>`;

const UPLOAD = '<div class="file-uploader__wrapper"><input type="file" style="display:none"><span class="sc-upl xYzAb">上传文件</span></div>';

const item = (label: string, control: string, required = true) =>
  `<div class="fields-col"><div class="form-item form-item--phoenix"><div class="form-item__title form-item__title--right">${
    required ? '<a class="form-item__required"><i class="icon-cus-bitian"></i></a>' : ''
  }<label class="form-item__text">${label}</label></div><div class="form-item__control">${control}</div></div></div>`;

const rows = (items: string[]) => {
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 2) out.push(`<div class="fields-row field-two clearfix">${items[i]}${items[i + 1] ?? ''}</div>`);
  return out.join('');
};

const form = (items: string[]) =>
  `<div class="ux-standard-form"><div class="form twoLineFormStyleLong formStyleLeftAndRight"><div class="form-part space-large size-large align-right"><div class="form-part-body clearfix">${rows(items)}</div></div></div></div>`;

/** One entry of a section that takes several, with its own 删除 beside it, as the page draws each. */
const entry = (items: string[]) =>
  `<div class="sc-entry aAbBc"><div class="sc-entry-body dDeEf"><div class="sc-entry-form gGhHi">${form(items)}</div></div><div class="sc-entry-tools jJkKl"><div class="sc-del mMnNo"><div class="sc-ico pPqQr"><svg class="icon"></svg></div><span class="sc-dt sStTu">删除</span></div></div></div>`;

/**
 * A span in two divs, every one shown as clickable, and nothing else saying it is a button. React writes 添加 and
 * the section's name as two pieces of text; the comment keeps them apart here.
 */
const ADD = (what: string) =>
  `<div class="sc-add vVwWx" style="cursor:pointer"><div class="sc-add-in yYzZa" style="cursor:pointer"><svg class="icon"></svg><span class="sc-add-t aBcDe" style="cursor:pointer">添加<!-- -->${what}</span></div></div>`;

/**
 * The entries of a repeated section, each in its own wrapper. The add button is not after the list: it sits inside
 * the last entry's wrapper, beside that entry, and moves into the new one when an entry is added (seen live).
 */
const list = (entries: string[], what: string) =>
  entries
    // The last wrapper is the same styled component with other props, so its style class differs (seen live).
    .map((e, i) => (i === entries.length - 1 ? `<div class="sc-wrap eEfFg">${e}${ADD(what)}</div>` : `<div class="sc-wrap bBcCd">${e}</div>`))
    .join('');

const section = (title: string, body: string, note = '') =>
  `<div class="sc-sect aBcDe"><div class="sc-title hIjKl">${title}</div>${note ? `<div class="sc-note mNoPq">${note}</div>` : ''}<div class="sc-body rStUv">${body}</div></div>`;

const project = [item('项目名称', INPUT()), item('开始时间', DATE, false), item('结束时间', DATE, false), item('项目描述', TEXTAREA, false), item('项目中职责', TEXTAREA, false)];

export const BEISEN_FORM =
  '<div class="sc-form-root kLmNo">' +
  section('个人信息', form([
    item('姓名', INPUT()),
    item('英文名', INPUT(), false),
    item('性别', beisenRadios(['男', '女', '保密'])),
    item('出生日期', DATE),
    item('邮箱', INPUT()),
    item('手机号码', WITH_TYPE('中国大陆', '请输入11位手机号')),
    item('证件号码', WITH_TYPE('身份证', '请输入')),
    item('证件照', UPLOAD),
    item('固定电话', INPUT(), false),
    item('现居住地', SELECT),
    item('户口所在地', SELECT),
    item('政治面貌', SELECT),
    item('婚否', beisenRadios(['未婚', '已婚', '离异', '保密', '丧偶'])),
    item('通讯地址', INPUT()),
    item('紧急联系人', INPUT()),
    item('紧急联系方式', INPUT()),
    item('期望工作地点', SELECT),
    item('期望工作地点二', SELECT),
    item('期望工作地点三', SELECT, false),
    item('生源地', SELECT),
    item('是否应届生', SELECT),
  ])) +
  section(
    '教育经历',
    list([entry([
      item('学校名称', INPUT()),
      item('开始时间', DATE),
      item('结束时间', DATE),
      item('专业名称', INPUT()),
      item('学历', SELECT),
      item('学位', SELECT),
      item('学习成绩排名', SELECT),
      item('担任职务', INPUT()),
      item('其他学校（第二学位）', INPUT(), false),
      item('其他专业（第二学位）', INPUT(), false),
    ])], '教育经历'),
    '请从大学以来的教育经历开始填写',
  ) +
  section('求职意向', form([item('期望从事行业', MULTI, false), item('期望从事职业', SELECT, false), item('期望工作城市', MULTI, false), item('期望月薪(税前)', SELECT, false)])) +
  section('语言能力', entry([item('英语水平', SELECT), item('其他外语', INPUT(), false)])) +
  section('技能', list([entry([item('技能名称', INPUT(), false), item('掌握程度', SELECT, false)])], '技能')) +
  section('在校实践', list([entry([item('开始时间', DATE, false), item('结束时间', DATE, false), item('实践描述', TEXTAREA, false)])], '在校实践')) +
  section('项目经历', list([entry(project), entry(project)], '项目经历')) +
  section('获奖情况', list([entry([item('获奖项', INPUT()), item('获奖时间', DATE)])], '获奖情况')) +
  section('附加信息', form([
    item('自我评价', TEXTAREA),
    item('是否愿意服从公司分配', beisenRadios(['是', '否'])),
    item('招聘信息来源渠道', SELECT),
    item('是否有亲属受雇于本公司', SELECT),
    item('受雇于本公司亲属信息', TEXTAREA, false),
  ])) +
  '</div>';

/** The questions of one entry, per section. No live form seen yet asks about internships: they are laid out as jobs. */
export const BEISEN_ENTRY_ITEMS = {
  education: [item('学校名称', INPUT()), item('开始时间', DATE), item('结束时间', DATE), item('专业名称', INPUT()), item('学历', SELECT)],
  internship: [item('公司名称', INPUT()), item('职位名称', INPUT()), item('开始时间', DATE), item('结束时间', DATE, false), item('工作描述', TEXTAREA, false)],
  projects: project,
  awards: [item('获奖项', INPUT()), item('获奖时间', DATE)],
};

/** Just the sections that take several entries, each with the one empty entry a fresh form shows. */
export const BEISEN_ENTRY_FORM =
  '<div class="sc-form-root kLmNo">' +
  section('教育经历', list([entry(BEISEN_ENTRY_ITEMS.education)], '教育经历')) +
  section('实习经历', list([entry(BEISEN_ENTRY_ITEMS.internship)], '实习经历')) +
  section('项目经历', list([entry(BEISEN_ENTRY_ITEMS.projects)], '项目经历')) +
  section('获奖情况', list([entry(BEISEN_ENTRY_ITEMS.awards)], '获奖情况')) +
  '</div>';
