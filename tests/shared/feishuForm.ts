// The shape of a real Feishu recruiting form (the ud-formily parts), classes as the page has them.
const label = (text: string, required = true) =>
  `<div class="ud-formily-item-label"><div class="ud-formily-item-label-content"><span><label>${text}</label>${required ? '<span class="ud-formily-item-asterisk">*</span>' : ''}</span></div><span class="ud-formily-item-colon"></span></div>`;
const item = (name: string, title: string, control: string, required = true) =>
  `<div data-form-field-id="${name}" data-form-field-name="${name}" id="formily-item-${name}" class="ud-formily-item"${''}>${label(title, required)}<div class="ud-formily-item-control"><div class="ud-formily-item-control-content"><div class="ud-formily-item-control-content-component">${control}</div></div></div></div>`;

const box = (name: string) =>
  `<div class="ud__input ud__input--size-lg"><label class="ud__input-input-wrap"><div class="ud__input-input__placeholder__wrapper"><input class="ud__native-input" data-form-field-name="${name}"></div></label></div>`;
const area = (name: string) => `<div class="ud__textarea"><textarea class="ud__textarea-native" data-form-field-name="${name}"></textarea></div>`;

export const feishuList = (shown = '') =>
  `<div class="ud__select select__45922b"><div class="ud__select__selector ud__select__selector-lg ud__select__selector-readOnly"><div class="ud__select__selector__content">${shown ? `<div class="ud__select__selector__selectItem ud__textOverflow">${shown}</div>` : ''}<div class="ud__select__selector__search"><input class="ud__select__selector__search__input ud__native-input" role="combobox" type="search" readonly=""></div></div><div class="ud__select__selector__arrow"><span class="universe-icon"></span></div></div></div>`;
export const feishuSearch = (name: string) => `<div class="ud__select"><div>${box(name)}</div></div>`;
/** One month, or one year when `format` is YYYY (获奖时间 asks only for that). */
export const feishuMonth = (format = 'YYYY-MM') =>
  `<div class="ud__picker ud__picker--size-lg"><div class="ud__picker-dateInput ud__picker-inputWrapper"><div class="ud__picker-inputWrapper-inner"><input class="ud__picker-input ud__native-input" size="12" placeholder="${format}"></div></div></div>`;
const clearable = () => box('').replace('</label>', '<span class="ud__input__clear-icon"></span></label>');
export const feishuSpan = () =>
  `<div class="throne-biz-date-range-picker-wrapper"><div class="throne-biz-date-range-picker-input">${clearable()}</div><div class="throne-biz-date-range-picker-rangeInput-seperator"><div class="throne-biz-date-range-picker-seperator"></div></div><div class="throne-biz-date-range-picker-input">${clearable()}</div></div>`;

const ADD = '<button class="ud__button" type="button"><span>添加</span></button>';
const moduleOf = (title: string, body: string) =>
  `<div class="applyFormModuleWrapper-windows applyFormModuleWrapper__d8a302"><div class="applyFormModuleWrapper-left"><div class="applyFormModuleWrapper-title"><p class="applyFormModuleWrapper-text sofiaBold">${title}</p></div><p class="applyFormModuleWrapper-desc"></p></div><div class="applyFormModuleWrapper-right"><div class="register-form-group-wrapper">${body}</div></div></div>`;
const cards = (id: string, card: string, count: number) =>
  `<div id="formily-item-${id}" class="ud-formily-item"><div class="ud-formily-item-control"><div class="ud-formily-item-control-content"><div class="ud-formily-item-control-content-component"><div class="apply-form-array-card__1d6856">${Array.from({ length: count }, () => `<div class="apply-form-array-card-content__1d6856"><div class="register-form-group-wrapper">${card}</div></div>`).join('')}${ADD}</div></div></div></div></div>`;

const schooling =
  item('school', '学校名称', feishuSearch('school')) +
  item('degree', '学历', feishuList()) +
  item('field_of_study', '专业', box('field_of_study')) +
  item('start_end_time', '起止时间', feishuSpan()) +
  item('education_type', '学历类型', feishuList());
const project =
  item('name', '项目名称', box('name')) +
  item('role', '项目角色', box('role'), false) +
  item('start_end_time', '起止时间', feishuSpan(), false) +
  item('link', '项目链接', box('link'), false) +
  item('desc', '描述', area('desc'), false);

// No live form seen yet asks about internships or awards: these use the parts and the ways of naming them above.
const internship =
  item('company', '公司名称', box('company')) +
  item('title', '职位名称', box('title')) +
  item('start_end_time', '起止时间', feishuSpan()) +
  item('desc', '描述', area('desc'), false);
const award = item('name', '奖项名称', box('name')) + item('award_time', '获奖时间', feishuMonth(), false) + item('desc', '描述', area('desc'), false);

/** Just the sections that take several entries, each with one empty card and 添加 under it. */
export const FEISHU_ENTRY_FORM =
  `<form><div class="ud-formily-layout">` +
  moduleOf('教育经历', cards('education_list', schooling, 1)) +
  moduleOf('实习经历', cards('internship_list', internship, 1)) +
  moduleOf('项目经历', cards('project_list', project, 1)) +
  moduleOf('获奖经历', cards('award_list', award, 1)) +
  `</div></form>`;

export const FEISHU_FORM =
  `<form><div class="ud-formily-layout">` +
  moduleOf('基本信息',
    item('name', '姓名', box('name')) +
    `<div data-form-field-name="mobile" id="formily-item-mobile" class="ud-formily-item">${label('手机号码')}<div class="ud-formily-item-control"><div class="ud-formily-item-control-content"><div class="ud-formily-item-control-content-component"><div class="wrapper__5ac24b">+86 000-0000-0000</div></div></div></div></div>` +
    item('email', '邮箱', box('email')) +
    item('gender', '性别', feishuList()) +
    item('birthday', '出生日期', feishuMonth())) +
  moduleOf('教育经历', cards('education_list', schooling, 2)) +
  moduleOf('项目经历', cards('project_list', project, 2)) +
  moduleOf('语言能力', item('language', '语言', feishuList()) + item('proficiency', '精通程度', feishuList())) +
  moduleOf('自我评价', item('self_evaluation', '自我评价', area('self_evaluation'), false)) +
  `<label class="ud__checkbox"><input type="checkbox" class="ud__checkbox-input"><span>我已阅读并同意隐私政策</span></label>` +
  `</div></form>`;

/**
 * A list of places drawn as a tree (NIO's 期望工作地点): country, province, city, each with a checkbox. Typing in the
 * box shows the places that match with the path down to them; the ticked ones show in the box. Returns how to stop.
 */
export function behaveAsPlaceTree(doc: Document, tree: Record<string, Record<string, string[]>>, ticked: string[] = []): () => void {
  const root = () => doc.querySelector<HTMLElement>('.ud__select')!;
  const input = () => root().querySelector<HTMLInputElement>('input')!;
  const panel = () => doc.querySelector<HTMLElement>('.ud__select__dropdown');
  // A place is ticked when it or a place it lies in is.
  const node = (text: string, depth: number, within: string[] = []) =>
    `<div class="ud__tree__node" data-depth="${depth}"><label class="ud__checkbox__wrapper ud__tree__node__checkbox"><span class="ud__checkbox"><input type="checkbox" class="ud__checkbox__input"${[text, ...within].some((t) => ticked.includes(t)) ? ' checked' : ''}></span></label><div class="ud__tree__node__label">${text}</div></div>`;
  const render = () => {
    const q = input().value.trim();
    const rows: string[] = [];
    for (const [country, provinces] of Object.entries(tree)) {
      if (!q) {
        rows.push(node(country, 0));
        continue;
      }
      for (const [province, cities] of Object.entries(provinces)) {
        const hits = cities.filter((c) => c.includes(q));
        if (hits.length === 0 && !province.includes(q)) continue;
        rows.push(node(country, 0), node(province, 1, [country]), ...hits.map((c) => node(c, 2, [country, province])));
      }
    }
    panel()!.innerHTML = `<div class="ud__tree">${rows.join('')}</div>`;
    root().querySelector('.ud__select__selector__content')!.innerHTML =
      ticked.map((t) => `<div class="ud__overflow__item"><span class="ud__tag ud__select__selector__tag"><div class="ud__tag__content">${t}</div></span></div>`).join('') +
      `<div class="ud__select__selector__search"><input class="ud__select__selector__search__input ud__native-input" value="${q}"></div>`;
  };
  const onClick = (e: Event) => {
    const t = e.target as Element;
    if (t.closest('.ud__select__selector') && !panel()) {
      doc.body.insertAdjacentHTML('beforeend', '<div class="ud__select__dropdown"></div>');
      render();
      return;
    }
    const box = t.closest('.ud__tree__node__checkbox');
    if (box) {
      const text = box.closest('.ud__tree__node')!.querySelector('.ud__tree__node__label')!.textContent!;
      const at = ticked.indexOf(text);
      if (at >= 0) ticked.splice(at, 1);
      else ticked.push(text);
      render();
    }
  };
  const onInput = (e: Event) => {
    if ((e.target as Element).closest('.ud__select') && panel()) {
      const value = (e.target as HTMLInputElement).value;
      render();
      input().value = value;
      render();
    }
  };
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('input', onInput, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('input', onInput, true);
  };
}

/** The box of such a list, empty. */
export const feishuPlaceList = () =>
  `<div class="ud__select"><div class="ud__select__selector ud__select__selector-lg"><div class="ud__select__selector__content"><div class="ud__select__selector__search"><input class="ud__select__selector__search__input ud__native-input"></div></div></div></div>`;
