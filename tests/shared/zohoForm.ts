// The shape of a Zoho Recruit application form as its Lyte components draw it once running, cut down. Ids and words
// are made up; tags, classes and attributes are as the page has them. Each row's label is a sibling of its control,
// never tied to it, and a row may hold two controls (the salutation list before the first name).

const label = (text: string, required = true) =>
  `<label class="crm-from-label"><lyte-yield yield-name="label_prefix_yield"></lyte-yield><span class="crc-label-text"><span>${text}</span>${required ? '<span class="crc-form-mandatory" aria-hidden="true">*</span>' : ''}<rec-form-tooltip></rec-form-tooltip></span></label>`;
const row = (id: string, text: string, field: string, required = true) =>
  `<div class="crc-form-row crc-rec-form_${id} ">${label(text, required)}<div class="crc-form-field ">${field}</div></div>`;

const textBox = (id: string, zcqa: string) =>
  `<crux-text-component id="rec-form_${id}" data-zcqa="rec_${zcqa}"><div class="cxElementValue "><lyte-input class="cxW100Per cxBoxInput lyteInputBox vertical crc-form-textfield"><div class="lyteField "><input type="text" id="" class="cxBorderBottom " maxlength="125" name="rec-form_${id}" placeholder="" autocomplete="false"></div></lyte-input></div></crux-text-component>`;

/** One list: the button shows the choice, or -None-. `items` live in a box Lyte moves to the end of <body> when opened. */
export const lyteList = (id: string, zcqa: string, items: string[], shown = '') =>
  `<crux-picklist-component id="rec-form_${id}" data-zcqa="rec_${zcqa}"><div class="cxElementValue "><lyte-dropdown id="${id}" class="cxBoxDropdown crc-form-dropdown" data-items="${items.join('|')}"><div class="lyteDummyEventContainer" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${zcqa}"><lyte-drop-button data-zcqa="manual_${zcqa}">${
    shown ? `<span class="lyteMarginRight lyteDropdownLabel">${shown}</span>` : '<span class="lyteDropPlaceholderNormal">-None-</span>'
  }<lyte-icon class="dropdown"></lyte-icon></lyte-drop-button></div></lyte-dropdown></div></crux-picklist-component>`;

/** Several answers: each one picked is a tag before the search box, and the list stays open. */
export const lyteMulti = (id: string, zcqa: string, items: string[], chosen: string[] = []) =>
  `<crux-picklist-component cx-prop-type="multiple" id="rec-form_${id}" data-zcqa="rec_${zcqa}"><div class="cxElementValue "><lyte-dropdown id="${id}" class="cxBoxDropdown crc-form-dropdown mandatoryField" data-items="${items.join('|')}"><div class="lyteDummyEventContainer" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${zcqa}"><lyte-drop-button data-zcqa="manual_${zcqa}"><ul class="lyteMultipleSelect">${chosen
    .map((c) => `<li data-value="${c}"><span class="lyteDropdownVisible">${c}</span><lyte-drop-remove class="lyteCloseIcon"></lyte-drop-remove></li>`)
    .join('')}<li class="lyteMultiselectInput"><lyte-search class="cxW100Per"><lyte-input is-search="true" class="lyteSearchInput lyteInput vertical"><div class="lyteField "><input type="text" id="inputId" maxlength="1000" autocomplete="off"></div></lyte-input></lyte-search></li></ul></lyte-drop-button></div></lyte-dropdown></div></crux-picklist-component>`;

/** A text box that suggests places as you type: whatever is typed stays. */
const autocomplete = (id: string, zcqa: string) =>
  `<crux-text-component id="rec-form_${id}" data-zcqa="rec_${zcqa}"><div class="cxElementValue "><div class="cxLookupComponent cxBoxWithRightIcon"><div class="cxBoxLeftContent"><lyte-autocomplete id="${id}"><lyte-dropdown><div class="lyteDummyEventContainer" role="combobox" aria-haspopup="listbox" aria-expanded="false"><lyte-drop-button><lyte-input class="lyteInputBox vertical cxBoxInput crc-form-textfield"><div class="lyteField "><input type="text" id="inputId" maxlength="255" autocomplete="off"></div></lyte-input></lyte-drop-button></div></lyte-dropdown></lyte-autocomplete></div></div></div></crux-text-component>`;

const COUNTRIES = ['US|United States|+1', 'GB|United Kingdom|+44', 'AU|Australia|+61', 'NZ|New Zealand|+64'];

/** The phone: a list of countries by flag and code, then the number box. */
const phone = (id: string) =>
  `<crux-phone-component id="rec-form_${id}" data-zcqa="rec_Mobile" selected-value="US"><div class="cxElementValue "><div class="cxDropdownInputGroup"><lyte-dropdown class="zrc-cc" data-items="${COUNTRIES.join(';')}" data-phone=""><div class="lyteDummyEventContainer" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false"><lyte-drop-button><lyte-yield yield-name="phoneDropdownButtonYield" selected-value="US"><div class="sl-selected"><div class="flag-drop-box"><span class="zrc-flag zrc-flag-us"></span><lyte-icon class="dropdown"></lyte-icon></div><span class="flag-drop-code">(+1)</span></div></lyte-yield></lyte-drop-button></div></lyte-dropdown><lyte-input class="cxW100Per lyteInputBox"><div class="lyteField "><input type="text" id="rec-form_${id}_input" name="rec-form_${id}" maxlength="30" autocomplete="false"></div></lyte-input></div></div></crux-phone-component>`;

export const WORK_RIGHTS = [
  'I have permanent work right no restritions',
  'I have tempory work rights with no restrictions',
  'I have tempory work rights with restrictions',
  'I require sponcership to work for a new employer',
];

export const zohoForm = (opts: { workRights?: string[] } = {}) =>
  `<div class="cw-apply-form"><div class="crc-form-row crc-section-1 crc-form-sec" role="region" aria-label="Basic Info"><h2 class="cw-section-title">Basic Info</h2>` +
  `<div class="crc-form-row crc-rec-form_101 ">${label('First Name')}<div class="crc-form-field cnl-firstname-row ">${lyteList('130', 'Salutation', ['-None-', 'Mr.', 'Mrs.', 'Ms.'])}${textBox('101', 'First_Name')}</div></div>` +
  row('102', 'Last Name', textBox('102', 'Last_Name')) +
  row('103', 'Email', textBox('103', 'Email')) +
  `<div class="crc-form-row crc-rec-form_104 ">${label('Mobile')}<div class="crc-form-field crux-country-droplist ">${phone('104')}</div></div>` +
  row('105', 'Working rights in Australia', lyteMulti('105', 'Working_rights_in_Australia', WORK_RIGHTS, opts.workRights ?? [])) +
  `</div><div class="crc-form-row crc-section-2 crc-form-sec" role="region" aria-label="Address Information"><h2 class="cw-section-title">Address Information</h2>` +
  row('106', 'Street', textBox('106', 'Street')) +
  `<div class="crc-form-row crc-rec-form_107 ">${label('City/ Town')}<div class="crc-form-field crc-form-autocomplete">${autocomplete('107', 'City')}</div></div>` +
  `<div class="crc-form-row crc-rec-form_108 ">${label('Province')}<div class="crc-form-field crc-form-autocomplete">${autocomplete('108', 'State')}</div></div>` +
  `<div class="crc-form-row crc-rec-form_109 ">${label('Post Code')}<div class="crc-form-field crc-form-autocomplete">${autocomplete('109', 'Zip_Code')}</div></div>` +
  row('110', 'Country', textBox('110', 'Country'), false) +
  `</div></div>`;

/**
 * Runs in the page: Lyte's behaviour, as seen on the real form. A press on a list's combobox puts its box at the end of
 * <body>; a press on an item sets the choice. A single list and the phone shut, a list of several stays open.
 */
export function mountLyte(): void {
  const shut = () => document.querySelectorAll('body > lyte-drop-box').forEach((b) => b.remove());
  document.addEventListener('mousedown', (e) => {
    if (!(e.target as Element).closest('body > lyte-drop-box')) shut();
  });
  document.addEventListener('click', (e) => {
    const opener = (e.target as Element).closest('.lyteDummyEventContainer');
    const dropdown = opener?.closest('lyte-dropdown');
    if (!opener || !dropdown || dropdown.closest('lyte-autocomplete')) return;
    shut();
    const isPhone = dropdown.hasAttribute('data-phone');
    const items = isPhone
      ? dropdown.getAttribute('data-items')!.split(';').map((c) => c.split('|'))
      : dropdown.getAttribute('data-items')!.split('|').map((v) => [v, v]);
    const box = document.createElement('lyte-drop-box');
    box.className = 'cxDropbox lyteDropdownDown';
    box.innerHTML = `<lyte-drop-body>${items
      .map(([value, name, code]) => `<lyte-drop-item data-value="${value}">${isPhone ? `<div class="rec-adv-mobile-items"><span class="lang-cn-name">${name}</span><span class="zrc-cc">${code}</span></div>` : name}</lyte-drop-item>`)
      .join('')}</lyte-drop-body>`;
    box.addEventListener('click', (ev) => {
      const item = (ev.target as Element).closest('lyte-drop-item');
      if (!item) return;
      const value = item.getAttribute('data-value')!;
      const button = dropdown.querySelector('lyte-drop-button')!;
      const list = button.querySelector('ul.lyteMultipleSelect');
      if (list) {
        if (!list.querySelector(`li[data-value="${value}"]`)) {
          list.querySelector('.lyteMultiselectInput')!.insertAdjacentHTML('beforebegin', `<li data-value="${value}"><span class="lyteDropdownVisible">${value}</span><lyte-drop-remove class="lyteCloseIcon"></lyte-drop-remove></li>`);
        }
        return;
      }
      if (isPhone) {
        const [, , code] = items.find(([v]) => v === value)!;
        button.querySelector('lyte-yield')!.setAttribute('selected-value', value);
        button.querySelector('.flag-drop-code')!.textContent = `(${code})`;
      } else {
        button.innerHTML = value === '-None-' ? '<span class="lyteDropPlaceholderNormal">-None-</span>' : `<span class="lyteMarginRight lyteDropdownLabel">${value}</span>`;
      }
      shut();
    });
    document.body.append(box);
  });
  document.addEventListener('click', (e) => {
    const remove = (e.target as Element).closest('lyte-drop-remove');
    if (remove) remove.closest('li')!.remove();
  });
}
