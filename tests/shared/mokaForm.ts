// The shape of a real Moka application form, classes as the page has them, words kept to what the form asks.
const INPUT = 'sd-Input-input-10L0t sd-Input-common-input-1XimE';
const ADDON =
  '<span class="sd-Input-addon-1Dv-z sd-Select-addon-26oV3"><div class="sd-Input-shadow-2mn0F"></div><span class="sd-Icon-container-1EGHG sd-Icon-iconcaretDown-juEqC sd-Input-icon--R4ZV sd-Select-icon-Bs6XN"></span></span>';

export const mokaSelect = (placeholder: string, shown = '') =>
  `<div class="sd-Dropdown-container-1CigZ"><label class="sd-Input-container-2S_vM sd-Select-container-1Eq4x sd-Input-lg-3X8ma"><span class="sd-Input-display-value-RwqDy sd-Input-display-value-spacing-2BKCS">${shown}</span><input type="text" class="${INPUT} sd-Input-has-addon-3djHe" placeholder="${placeholder}">${ADDON}</label><span></span></div>`;
const text = (placeholder: string) =>
  `<div class="sd-Tooltip-container-2B2OE"><label class="sd-Input-container-2S_vM string_info no-adaptive-tooltip sd-Input-lg-3X8ma"><input type="text" class="${INPUT}" placeholder="${placeholder}"></label></div>`;
const month = `<div class="item-half-mz_My7kExy">${mokaSelect('年')}</div><div class="item-half-mz_My7kExy">${mokaSelect('月')}</div>`;

/** A list that takes several answers: each one picked shows as a tag inside the box, and the list stays open. */
export const mokaMulti = (placeholder = '请选择') =>
  `<div class="sd-Dropdown-container-1CigZ"><label class="sd-Input-container-2S_vM sd-Select-container-1Eq4x multi_select_info no-adaptive-tooltip sd-Input-lg-3X8ma"><div><span class="sd-Input-input-10L0t sd-Input-tag-container-1AfzM sd-Input-lg-3X8ma sd-Input-has-addon-3djHe"><input type="text" class="sd-Input-tag-input-pfCKo sd-Input-common-input-1XimE" placeholder="${placeholder}"></span></div>${ADDON}</label><span></span></div>`;

/** A span with a box for a job still going: ticking 至今 takes the end's two lists off the page. */
export const MOKA_STILL = '<span class="sign-MhIus99jyR"><label class="sd-Checkbox-container-3IoOq"><span class="sd-Checkbox-box-1tF62"><span class="sd-Checkbox-checker-Y9ZGJ"><input type="checkbox" class="sd-Checkbox-input-1uFHv" value=""></span></span><span class="sd-Checkbox-label-187mu"><div class="sd-Checkbox-label-text-3hBVW">至今</div></span></label></span>';
const spanWithStill = `<div class="month-range-select date_info wrapper-Wilqy7sjl0"><label class="label-ZJNsc2aXvx"></label><span>${month}</span><span class="till-QjTOI37re2">-<br></span><span class="span-end">${month}</span>${MOKA_STILL}</div>`;

const field = (type: string, title: string, control: string, required = true) =>
  `<div class="apply-field-Q2iJ7AtQGX ${type} apply-filed-padding-gvR51AnKq6"><div class="title-IWWQ0Xa4L7"><span><span>${title}</span></span>${required ? '<span class="required-asterisk-av7daEKsLS"></span>' : ''}</div><div class="ctrl-CICMG4Fr4_">${control}<div><div class="describe-GCCjupJ4ID"></div></div></div></div>`;
/** A block may carry a line of advice under its title, inside the title's own box. */
const block = (title: string, fields: string, button = '', note = '') =>
  `<div class="apply-block-KRDTLLb5hU"><div class="blockTitle-dcmrfhpkg1"><div class="sd-Spacing-spacing-inline-2zHeO sd-Spacing-justify-between-3DYHz"><span class="text-JHHb1llnzL theme-border-color"><span>${title}</span></span>${button}</div>${note ? `<div class="describe-GCCjupJ4ID"><span>${note}</span></div>` : ''}</div><div class="apply-fields-BzcXI4i2Pm">${fields}</div></div>`;

const ADD = '<button class="sd-Button-container-1cq0K sd-Button-text-1IIJk" type="button"><span class="sd-Button-content-1Zgzx"><span><span>添加</span></span></span></button>';

export const MOKA_FORM =
  `<div class="apply-blocks-ir_MrIodtj">` +
  block(
    '申请信息',
    field('Select-oqOV0aGogs', '意向工作城市', mokaSelect('选择意向工作城市')) +
      field('string_info-UOJxKN5mtC', '推荐码', text('推荐码'), false),
  ) +
  block(
    '上传',
    field('file_upload-MPorXc4w3A', '上传简历', '<div class="file_upload"><button class="sd-Button-container-1cq0K file_upload-btn" type="button"><span>上传简历</span></button><input id="resumeKey" type="file" name="resumeKey"></div>') +
      field('attachment_upload-rjeAA_yPz7', '上传附件', '<div class="sd-Upload-upload-wrap-2c_YS"><input type="file"><button class="sd-Button-container-1cq0K file_upload-btn" type="button"><span>上传</span></button></div>', false),
  ) +
  block(
    '个人信息',
    field('string_info-UOJxKN5mtC', '姓名', text('姓名')) +
      field('string_info-UOJxKN5mtC', '手机号码', `<div class="wrapper-zOQxgCZej2 string_info"><div class="code-fpHCe5Nr_7">${mokaSelect('', '<span class="">+86</span>')}</div><div class="number-PjeQbgfkLz"><label class="sd-Input-container-2S_vM sd-Input-lg-3X8ma"><input type="text" class="${INPUT}" placeholder="请输入手机号"></label></div></div>`) +
      field('string_info-UOJxKN5mtC', '邮箱', text('邮箱')) +
      field('day_info-S5Nug1w6IL', '出生日期 (年龄)', `<div class="sd-Dropdown-container-1CigZ"><label class="sd-Input-container-2S_vM day_info sd-Input-lg-3X8ma"><input type="text" class="${INPUT} sd-Input-has-addon-3djHe" readonly="" placeholder="出生日期 (年龄)"><span class="sd-Input-addon-1Dv-z sd-picker-addon-1SMM0"><div></div></span></label><span></span></div>`) +
      field('date_info-nCj8tT_zjw', '毕业时间', `<div class="month-range-select date_info wrapper-Wilqy7sjl0"><label class="label-ZJNsc2aXvx"></label><span>${month}</span></div>`) +
      field('Select-oqOV0aGogs', '最高学历', mokaSelect('请选择')) +
      field('bool_info-qV6GUinJsJ', '是否接收组织调配', mokaSelect('请选择')) +
      field('multi_select_info-OvKzabLoLf', '语言技能', mokaMulti()) +
      field('multi_select_info-OvKzabLoLf', '英语等级', mokaMulti()) +
      field('location_info-D41gUYJobm', '籍贯', `<div class="sd-Dropdown-container-1CigZ container-ukSuRKdZ3K"><label class="sd-Input-container-2S_vM sd-Input-lg-3X8ma sd-Input-readonly-35zdZ"><div><span class="sd-Input-input-10L0t sd-Input-tag-container-1AfzM sd-Input-lg-3X8ma sd-Input-has-addon-3djHe"><input type="text" class="sd-Input-tag-input-pfCKo sd-Input-common-input-1XimE" readonly="" placeholder="请输入籍贯"></span></div><span class="sd-Input-addon-1Dv-z"><div></div><span class="sd-Icon-container-1EGHG sd-Icon-iconcaretDown-juEqC suffix-JuFycnhumt"></span></span></label><span></span></div>`, false),
  ) +
  block(
    '教育背景',
    field('date_info-nCj8tT_zjw full-width-field-_9KdqB6mcu', '就读时间', `<div class="month-range-select date_info wrapper-Wilqy7sjl0"><label class="label-ZJNsc2aXvx"></label><span>${month}</span><span class="till-QjTOI37re2">-<br></span><span>${month}</span></div>`) +
      field('string_info-UOJxKN5mtC', '学校名称', mokaSelect('请输入就读学校')) +
      field('string_info-UOJxKN5mtC', '专业名称', mokaSelect('请输入专业名称')) +
      field('Select-oqOV0aGogs', '学历', mokaSelect('请选择')) +
      field('string_info-UOJxKN5mtC', '在校导师', text('在校导师'), false) +
      '<button class="sd-Button-container-1cq0K remove-gIFww9IvGS" type="button"><span><span>删除本条</span></span></button>',
    ADD,
  ) +
  block(
    '工作经历',
    field('string_info-UOJxKN5mtC', '公司名称', text('公司名称')) +
      field('date_info-nCj8tT_zjw full-width-field-_9KdqB6mcu', '起止时间', spanWithStill, false),
    ADD,
    '如为实习经历可在职位名称上备注实习生',
  ) +
  block(
    '语言能力',
    field('select_info-zjdod05hST', '语言类型', mokaSelect('请选择')) + field('string_info-UOJxKN5mtC', '所获证书', text('所获证书'), false),
    ADD,
    '除英语外的其他外语能力',
  ) +
  block('实习意向', field('select_info-zjdod05hST', '是否需要/可以提前实习', mokaSelect('请选择')), ADD) +
  block(
    '更新说明',
    `<div class="apply-field-Q2iJ7AtQGX confirm_info-iqEC7RvBDg"><div class="ctrl-CICMG4Fr4_"><label class="sd-Checkbox-container-3IoOq"><span class="sd-Checkbox-box-1tF62"><input type="checkbox" class="sd-Checkbox-input-1uFHv"></span><span class="sd-Checkbox-label-187mu"><div class="sd-Checkbox-label-text-3hBVW"><span>同步更新在线简历</span></div></span></label></div></div>`,
  ) +
  `</div>`;

/** Every Moka page carries this hidden version tag, on a company's own domain too. */
export const MOKA_MARKER =
  '<input style="display: none" id="moka-version" data-gray-released="0" data-version="20260101-0000-00000-release">';

// ---- sections that take several entries --------------------------------------------------------------------------

/** A span, with or without the 至今 box that takes the end's two lists off the page (工作经历 and 项目经验). */
const span = (still: boolean) =>
  still ? spanWithStill : `<div class="month-range-select date_info wrapper-Wilqy7sjl0"><label class="label-ZJNsc2aXvx"></label><span>${month}</span><span class="till-QjTOI37re2">-<br></span><span>${month}</span></div>`;
const area = (placeholder: string) =>
  `<div class="sd-Textarea-container-1Hj7A" style="width: 100%;"><textarea class="sd-Textarea-textarea-dyLbN text_info" placeholder="${placeholder}"></textarea></div>`;
const yearMonth = `<div class="month-range-select date_info wrapper-Wilqy7sjl0"><label class="label-ZJNsc2aXvx"></label><span>${month}</span></div>`;

const ADD_WITH_ICON =
  '<button class="sd_global_focus_controller_class sd-Button-container-1cq0K sd-Button-text-1IIJk" type="button"><span class="sd-Button-content-1Zgzx"><span class="sd-Icon-container-1EGHG sd-Icon-iconadd-2bWGG sd-Button-left-icon-21UeS"></span><span><span>添加</span></span></span></button>';
const REMOVE_ENTRY =
  '<div class="sd-Tooltip-container-2B2OE"><button class="sd_global_focus_controller_class sd-Button-container-1cq0K" type="button"><span class="sd-Button-content-1Zgzx"><span><span>删除本条</span></span></span></button></div>';

/** One entry: its questions, then 删除本条. */
export const mokaEntry = (fields: string) => `<div class="apply-fields-BzcXI4i2Pm multi-NTCDdF2lci">${fields}${REMOVE_ENTRY}</div>`;

/** The questions of one entry, per section, in the order the live form asks them. */
export const MOKA_ENTRY_FIELDS = {
  education:
    field('Select-oqOV0aGogs', '学历', mokaSelect('请选择')) +
    field('string_info-UOJxKN5mtC', '学校名称', mokaSelect('请输入就读学校')) +
    field('string_info-UOJxKN5mtC', '专业名称', mokaSelect('请输入专业名称')) +
    field('date_info-nCj8tT_zjw', '就读时间', span(false)),
  work:
    field('string_info-UOJxKN5mtC', '公司名称', text('公司名称'), false) +
    field('string_info-UOJxKN5mtC', '职位名称', text('职位名称'), false) +
    field('date_info-nCj8tT_zjw', '起止时间', span(true), false) +
    field('text_info-YMkFcQzvoO', '工作职责', area('内容'), false),
  projects:
    field('string_info-UOJxKN5mtC', '项目名称', text('项目名称'), false) +
    field('text_info-YMkFcQzvoO', '项目中职责', area('项目中职责'), false) +
    field('date_info-nCj8tT_zjw', '起止时间', span(true), false) +
    field('text_info-YMkFcQzvoO', '项目描述', area('内容'), false),
  // No live Moka form seen yet asks about awards: the same parts, under the words such a section would use.
  awards:
    field('string_info-UOJxKN5mtC', '奖项名称', text('奖项名称'), false) +
    field('date_info-nCj8tT_zjw', '获奖时间', yearMonth, false),
};

/**
 * A section that takes several entries: 添加 beside its title adds an empty entry under the last one, and the page
 * starts with one empty entry. The live 工作经历 has a line under its title saying internships go there too.
 */
export const mokaEntryBlock = (title: string, fields: string, note = '', entries = 1) =>
  `<div class="apply-block-KRDTLLb5hU"><div class="blockTitle-dcmrfhpkg1"><div class="sd-Spacing-spacing-inline-2zHeO sd-Spacing-stretched-1WTcn sd-Spacing-align-center-1syHL"><span class="text-JHHb1llnzL theme-border-color"><span>${title}</span></span>${ADD_WITH_ICON}</div>${
    note ? `<div class="describe-GCCjupJ4ID"><span>${note}</span></div>` : ''
  }</div>${Array.from({ length: entries }, () => mokaEntry(fields)).join('')}</div>`;

/** Just the sections that take several entries, as the live desktop form lays them out. */
export const MOKA_ENTRY_FORM =
  `<div class="apply-blocks-ir_MrIodtj">${MOKA_MARKER}` +
  block('个人信息', field('string_info-UOJxKN5mtC', '姓名', text('姓名'))) +
  mokaEntryBlock('教育背景', MOKA_ENTRY_FIELDS.education) +
  mokaEntryBlock('工作经历', MOKA_ENTRY_FIELDS.work, '如为实习经历可在职位名称上备注实习生') +
  mokaEntryBlock('项目经验', MOKA_ENTRY_FIELDS.projects) +
  mokaEntryBlock('获奖情况', MOKA_ENTRY_FIELDS.awards) +
  `</div>`;

/** The desktop form's only button at the bottom: it opens a preview that sends the application. */
export const MOKA_SUBMIT =
  '<div class="submitApply-s_IljbB0Og"><div class="sd-Tooltip-container-2B2OE"><button class="sd_global_focus_controller_class sd-Button-container-1cq0K sd-Button-primary-Riulm sd-Button-lg-3bz1y btn-bg-color no-adaptive-tooltip" type="button"><span class="sd-Button-content-1Zgzx"><span>预览并提交</span></span></button></div></div>';

/**
 * The resume box. While the page uploads a resume and reads it, its button spins (desktop: the button itself; on a
 * phone a spinner takes the place of the plus sign), and only then does the page write what it read into the form.
 */
export const mokaResumeUpload = (reading: boolean) =>
  `<div class="file_upload"><button class="sd-Button-container-1cq0K file_upload-btn" type="button">${
    reading ? '<span class="sd-Loading-loading-3G2L9 sd-Loading-sm-circle-2HzYR"></span>' : ''
  }<span class="sd-Button-content-1Zgzx"><span>${reading ? '上传中...' : '上传简历'}</span></span></button><input id="resumeKey" type="file" name="resumeKey"></div>`;

const mobileText = (title: string) =>
  `<div class="applyField-Uxo0YVBxOp  "><div class="title-info-Bb7QUC5Eao"><span class="title-VjPF9BH7ee"><span>${title}</span></span></div><div class="string_info"><input class="" autocomplete="new_password" placeholder="请输入"></div><div class="describe-Px7yQoZJQ_"></div></div>`;

const mobileFooter = (label: string) =>
  `<div class="mobile-layout__footer footer-Hwo1ezSUI3"><div class="button-group-wsKLhNnVUI"><button class="sd-Button-container-1fiHu sd-Button-primary-3qcnn sd-Button-lg-3bAh3 button-mtbjAb6F8U"><span class="sd-Button-content-3zdjd"><span>${label}</span></span></button></div></div>`;

/**
 * The phone form (/m/...): one block per step, all of them on the page, only the current one shown. Each says
 * "Step: n/N" above its title. The footer button says 下一步 until the last step, where the page writes its own word
 * for sending (`send`).
 */
export function mokaMobileSteps(steps: Array<{ title: string; fields: string[] }>, send = '提交') {
  const blocks = steps
    .map(
      (s, i) =>
        `<div style="display: ${i === 0 ? 'block' : 'none'};"><div class="block-VHJa37wvFc"><div class="count-Kc4gBJyqZe">Step: ${i + 1}/${steps.length}</div><div class="title-VjPF9BH7ee fix-title-NF8409QjM4"><span>${s.title}</span></div><div class="progress-QCxGVE0NRE" style="width: ${Math.round(((i + 1) / steps.length) * 100)}%;"></div><div class="field-block-JlfnJpR0gc"><div class="applyFields-bZxf8hWvHr">${s.fields.map(mobileText).join('')}</div></div></div></div>`,
    )
    .join('');
  return {
    html: `<div class="mobile">${MOKA_MARKER}<div class="mobile-layout__content content-oRUAsaIAd8 has-header"><div class="mobile-layout__padding"></div>${blocks}</div>${mobileFooter(steps.length > 1 ? '下一步' : send)}</div>`,
    /** A stand-in for the page: the footer button shows the next block, and on the last one it sends (`onSend`). */
    wire(doc: Document, onSend: () => void) {
      const blocksOf = () => Array.from(doc.querySelectorAll<HTMLElement>('.mobile-layout__content > div[style]'));
      const label = () => doc.querySelector('.mobile-layout__footer button span span')!;
      doc.querySelector('.mobile-layout__footer button')!.addEventListener('click', () => {
        const all = blocksOf();
        const at = all.findIndex((b) => b.style.display === 'block');
        if (at === all.length - 1) return onSend();
        all[at]!.style.display = 'none';
        all[at + 1]!.style.display = 'block';
        if (at + 1 === all.length - 1) label().textContent = send;
      });
    },
  };
}
