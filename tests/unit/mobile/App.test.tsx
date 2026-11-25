// Mobile app profile page (简历资料): every module and field the extension editor covers, the phone-specific
// editors (bottom-sheet enums, three-way yes/no, chips for lists), the resume switcher, autosave and the back key.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App, { type Platform } from '../../../mobile/app/src/App';
import { createMemoryAppStateStore } from '../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore } from '../../../mobile/app/src/store/fileStore';
import { createMemoryStore, type ProfileStore } from '../../../mobile/app/src/store/profileStore';
import { createStoreWiper } from '../../../mobile/app/src/store/wipe';
import { MODULES, enumLabel, type FieldMeta, type ModuleMeta } from '../../../src/editor';
import { setLanguage, translate } from '../../../src/i18n';
import { EducationSchema, ProfileSchema, ResumeSchema, type Profile, type Resume } from '../../../src/schema';

const DELAY = 20;
const WAIT = { timeout: 4000 };
const zh = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);

const EDITABLE = MODULES.filter((m) => m.container !== 'attachments');

function makeProfile(resumes: { id: string; title: string; locale?: 'zh-CN' | 'en-AU' }[] = [{ id: 'r1', title: '我的简历' }]): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: resumes.map((r) => ResumeSchema.parse({ locale: 'zh-CN', ...r })),
    activeResumeId: resumes[0]?.id ?? null,
    settings: { uiLanguage: 'zh' },
  });
}

/** A platform whose back key and pause the test presses by hand. */
function fakePlatform() {
  let back: (() => boolean) | null = null;
  let pause: (() => void) | null = null;
  const platform: Platform = {
    onBack(handler) {
      back = handler;
      return () => {
        back = null;
      };
    },
    onPause(handler) {
      pause = handler;
      return () => {
        pause = null;
      };
    },
  };
  return { platform, pressBack: () => back!(), pause: () => pause!() };
}

let store: ProfileStore;
let device: ReturnType<typeof fakePlatform>;

async function renderApp(profile: Profile = makeProfile(), delay = DELAY) {
  store = createMemoryStore(profile);
  device = fakePlatform();
  const files = createMemoryFileStore();
  const appState = createMemoryAppStateStore({ version: 1, onboardingDone: true });
  const wiper = createStoreWiper({ profile: store, files, appState });
  const view = render(
    <App store={store} files={files} appState={appState} wiper={wiper} platform={device.platform} autosaveDelayMs={delay} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '简历' }, WAIT));
  await screen.findByRole('heading', { level: 1, name: '简历资料' });
  return view;
}

const saved = async (): Promise<Resume> => {
  const p = await store.load();
  return p.resumes.find((r) => r.id === p.activeResumeId)!;
};
const until = (check: (r: Resume) => void) => waitFor(async () => check(await saved()), WAIT);

const openModule = (meta: ModuleMeta) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${esc(zh(meta.labelKey))}`) }));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const addEntry = (meta: ModuleMeta) =>
  fireEvent.click(screen.getByRole('button', { name: zh('options.add', { name: zh(meta.labelKey) }) }));
const enumButton = (label: string) => screen.getByRole('button', { name: new RegExp(`^${esc(label)}`) });
/** Pick an option from an enum's bottom sheet. */
const choose = (label: string, option: string) => {
  fireEvent.click(enumButton(label));
  const sheet = screen.getByRole('dialog', { name: label });
  fireEvent.click(within(sheet).getByRole('radio', { name: option }));
};

/** The control the page shows for one field, found by its accessible name. Throws when it is missing. */
function controlFor(field: FieldMeta): HTMLElement {
  const label = zh(field.labelKey);
  switch (field.input) {
    case 'region':
      return screen.getByRole('group', { name: label });
    case 'bool':
      return screen.getByRole('radiogroup', { name: label });
    case 'select':
      return enumButton(label);
    case 'list':
      return screen.getByRole('textbox', { name: label });
    default:
      return screen.getByLabelText(label);
  }
}

beforeEach(() => setLanguage('zh'));
afterEach(() => {
  cleanup();
  setLanguage('en');
});

describe('Profile page – module list', () => {
  it('lists every module the extension editor edits, in its order, attachments last', async () => {
    await renderApp();
    const names = within(screen.getByRole('list', { name: '简历模块' }))
      .getAllByRole('button')
      .map((b) => b.querySelector('.m-row__name')!.textContent);
    expect(names).toEqual(MODULES.map((m) => zh(m.labelKey)));
    expect(MODULES).toHaveLength(21);
    expect(names.at(-1)).toBe('附件');
  });

  it('offers to start a resume when there is none, and saves the new one', async () => {
    await renderApp(makeProfile([]));
    fireEvent.click(screen.getByRole('button', { name: '新建中文简历' }));
    await waitFor(async () => expect((await store.load()).resumes).toHaveLength(1), WAIT);
    expect((await saved()).locale).toBe('zh-CN');
    expect(screen.getByRole('list', { name: '简历模块' })).toBeTruthy();
  });

  it('shows how much of each module is filled', async () => {
    const profile = makeProfile();
    profile.resumes[0]!.basics.familyName = '张';
    profile.resumes[0]!.basics.givenName = '三';
    profile.resumes[0]!.education.push(EducationSchema.parse({ school: '示例大学' }));
    await renderApp(profile);
    expect(screen.getByRole('button', { name: /^基本信息/ }).textContent).toContain('已填 2 项');
    expect(screen.getByRole('button', { name: /^教育经历/ }).textContent).toContain('1 条 · 示例大学');
    expect(screen.getByRole('button', { name: /^求职意向/ }).textContent).toContain('还没填');
  });
});

describe('Profile page – every module and field is editable', () => {
  it.each(EDITABLE.map((m) => [zh(m.labelKey), m] as const))('%s', async (_name, meta) => {
    await renderApp();
    openModule(meta);
    expect(screen.getByRole('heading', { level: 1, name: zh(meta.labelKey) })).toBeTruthy();
    if (meta.repeatable) {
      expect(screen.getByText(zh('options.noEntries', { name: zh(meta.labelKey) }))).toBeTruthy();
      addEntry(meta);
    }
    for (const field of meta.fields) expect(controlFor(field), field.key).toBeTruthy();
  });
});

describe('Profile page – field editors', () => {
  const jobIntention = MODULES.find((m) => m.module === 'jobIntention')!;
  const languages = MODULES.find((m) => m.module === 'languages')!;
  const education = MODULES.find((m) => m.module === 'education')!;
  const work = MODULES.find((m) => m.module === 'work')!;
  const basics = MODULES.find((m) => m.module === 'basics')!;

  it('求职意向 → 意向城市: adds cities with the plus button and Enter, removes one by its chip', async () => {
    await renderApp();
    openModule(jobIntention);
    const input = screen.getByRole('textbox', { name: '意向城市' });
    fireEvent.change(input, { target: { value: '北京' } });
    fireEvent.click(screen.getByRole('button', { name: '添加意向城市' }));
    fireEvent.change(input, { target: { value: '上海、深圳' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await until((r) => expect(r.jobIntention.cities).toEqual(['北京', '上海', '深圳']));
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '删除北京' }));
    await until((r) => expect(r.jobIntention.cities).toEqual(['上海', '深圳']));
  });

  it('意向城市: Enter that confirms a Chinese input-method composition adds nothing', async () => {
    await renderApp();
    openModule(jobIntention);
    const input = screen.getByRole('textbox', { name: '意向城市' });
    fireEvent.change(input, { target: { value: 'bei' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect((input as HTMLInputElement).value).toBe('bei');
    expect(screen.queryByRole('button', { name: '删除bei' })).toBeNull();
    fireEvent.change(input, { target: { value: '北京' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await until((r) => expect(r.jobIntention.cities).toEqual(['北京']));
  });

  it('语言 → 熟练程度: picks a level from the bottom sheet and can clear it again', async () => {
    await renderApp();
    openModule(languages);
    addEntry(languages);
    type('语言', '英语');
    const proficient = enumLabel('proficiency', 'proficient', 'zh');
    choose('熟练程度', proficient);
    await until((r) => expect(r.languages[0]).toMatchObject({ language: '英语', proficiency: 'proficient' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(enumButton('熟练程度').textContent).toContain(proficient);
    choose('熟练程度', zh('common.unset'));
    await until((r) => expect(r.languages[0]!.proficiency).toBeNull());
  });

  it('offers no "unset" for an enum the schema requires (work kind)', async () => {
    await renderApp();
    openModule(work);
    addEntry(work);
    fireEvent.click(enumButton('经历类型'));
    const sheet = screen.getByRole('dialog', { name: '经历类型' });
    expect(within(sheet).queryByRole('radio', { name: zh('common.unset') })).toBeNull();
    expect(within(sheet).getAllByRole('radio')).toHaveLength(3);
  });

  it('yes / no fields have three states: yes, no and not set', async () => {
    await renderApp();
    openModule(jobIntention);
    const group = screen.getByRole('radiogroup', { name: '是否接受调剂' });
    fireEvent.click(within(group).getByRole('radio', { name: '是' }));
    await until((r) => expect(r.jobIntention.acceptAdjustment).toBe(true));
    fireEvent.click(within(group).getByRole('radio', { name: '否' }));
    await until((r) => expect(r.jobIntention.acceptAdjustment).toBe(false));
    fireEvent.click(within(group).getByRole('radio', { name: zh('common.unset') }));
    await until((r) => expect(r.jobIntention.acceptAdjustment).toBeNull());
  });

  it('end month with "present": ticking it clears the date and disables the picker', async () => {
    await renderApp();
    openModule(education);
    addEntry(education);
    type('开始时间', '2023-09');
    type('结束时间', '2027-06');
    await until((r) => expect(r.education[0]).toMatchObject({ startDate: '2023-09', endDate: '2027-06', current: false }));
    fireEvent.click(screen.getByRole('checkbox', { name: '至今' }));
    await until((r) => expect(r.education[0]).toMatchObject({ endDate: null, current: true }));
    expect((screen.getByLabelText('结束时间') as HTMLInputElement).disabled).toBe(true);
  });

  it('numbers, dates and regions are stored in the schema shapes', async () => {
    await renderApp();
    openModule(basics);
    type('身高 (cm)', '175');
    type('出生日期', '2003-04-05');
    const native = screen.getByRole('group', { name: '籍贯' });
    fireEvent.change(within(native).getByLabelText('籍贯 – 省 / 直辖市'), { target: { value: '示例省' } });
    await until((r) => {
      expect(r.basics.height).toBe(175);
      expect(r.basics.birthDate).toBe('2003-04-05');
      expect(r.basics.nativePlace.province).toBe('示例省');
    });
    type('身高 (cm)', '');
    await until((r) => expect(r.basics.height).toBeNull());
  });

  it('keeps an invalid value on screen, marks it, and does not save it', async () => {
    await renderApp();
    openModule(basics);
    type('姓', '李');
    await until((r) => expect(r.basics.familyName).toBe('李'));
    type('体重 (kg)', '-3');
    await screen.findByText(zh('options.needsLook'), undefined, WAIT);
    expect(screen.getByLabelText('体重 (kg)').getAttribute('aria-invalid')).toBe('true');
    await new Promise((r) => setTimeout(r, DELAY * 3));
    expect((await saved()).basics.weight).toBeNull();
  });

  it('keeps saving the other fields while one field is invalid', async () => {
    await renderApp();
    openModule(basics);
    type('体重 (kg)', '-3');
    type('名', '小明');
    type('身高 (cm)', '175');
    await until((r) => expect(r.basics).toMatchObject({ givenName: '小明', height: 175, weight: null }));
    expect(screen.getByText(zh('options.needsLook'))).toBeTruthy();
    expect((screen.getByLabelText('体重 (kg)') as HTMLInputElement).value).toBe('-3');
  });
});

describe('Profile page – entries', () => {
  const languages = MODULES.find((m) => m.module === 'languages')!;

  it('moves an entry down and deletes one with undo', async () => {
    await renderApp();
    openModule(languages);
    addEntry(languages);
    type('语言', '英语');
    addEntry(languages);
    // The newest entry is open, the earlier one folds to its summary.
    expect(screen.getAllByLabelText('语言')).toHaveLength(1);
    type('语言', '日语');
    await until((r) => expect(r.languages.map((l) => l.language)).toEqual(['英语', '日语']));

    fireEvent.click(screen.getByRole('button', { name: '更多操作：语言能力 1' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '下移' }));
    await until((r) => expect(r.languages.map((l) => l.language)).toEqual(['日语', '英语']));

    fireEvent.click(screen.getByRole('button', { name: '更多操作：语言能力 1' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: zh('options.removeEntry') }));
    await until((r) => expect(r.languages.map((l) => l.language)).toEqual(['英语']));
    fireEvent.click(screen.getByRole('button', { name: zh('options.undo') }));
    await until((r) => expect(r.languages.map((l) => l.language)).toEqual(['日语', '英语']));
  });
});

describe('Profile page – resume switcher', () => {
  const twoResumes = () =>
    makeProfile([
      { id: 'r1', title: '中文版简历' },
      { id: 'r2', title: 'English resume', locale: 'en-AU' },
    ]);
  const openSwitcher = () => fireEvent.click(screen.getByRole('button', { name: /^正在编辑/ }));

  it('switches the resume being edited', async () => {
    await renderApp(twoResumes());
    openSwitcher();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: /English resume/ }));
    await waitFor(async () => expect((await store.load()).activeResumeId).toBe('r2'), WAIT);
    expect(screen.getByRole('button', { name: /^正在编辑/ }).textContent).toContain('English resume');
  });

  it('creates an English resume and makes it the one being edited', async () => {
    await renderApp();
    openSwitcher();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '新建英文简历' }));
    await until((r) => expect(r.locale).toBe('en-AU'));
    expect((await store.load()).resumes).toHaveLength(2);
  });

  it('renames the current resume', async () => {
    await renderApp();
    openSwitcher();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '改名' }));
    fireEvent.change(screen.getByLabelText('简历名称'), { target: { value: '校招用' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await until((r) => expect(r.title).toBe('校招用'));
  });

  it('deletes the current resume, with undo', async () => {
    await renderApp(twoResumes());
    openSwitcher();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除这份简历' }));
    await waitFor(async () => expect((await store.load()).resumes.map((r) => r.id)).toEqual(['r2']), WAIT);
    fireEvent.click(screen.getByRole('button', { name: zh('options.undo') }));
    await waitFor(async () => expect((await store.load()).resumes.map((r) => r.id)).toEqual(['r1', 'r2']), WAIT);
  });
});

describe('Profile page – language, back key and pause', () => {
  it('switches the interface to English and remembers it', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'EN' }, WAIT));
    fireEvent.click(await screen.findByRole('button', { name: 'Resumes' }, WAIT));
    await screen.findByRole('heading', { level: 1, name: 'Resume details' });
    expect(screen.getByRole('button', { name: new RegExp(`^${esc(translate('en', 'options.module.basics'))}`) })).toBeTruthy();
    await waitFor(async () => expect((await store.load()).settings.uiLanguage).toBe('en'), WAIT);
  });

  it('the sensitive-field choice is stored with the time it was made, so sync and import keep the newer one', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(await screen.findByRole('button', { name: /^敏感字段只提醒/ }, WAIT));
    const before = Date.now();
    fireEvent.click(within(screen.getByRole('dialog', { name: '敏感字段怎么填' })).getByRole('radio', { name: /^直接填/ }));
    await waitFor(async () => expect((await store.load()).settings.sensitiveFields).toBe('fill'), WAIT);
    expect((await store.load()).settings.sensitiveFieldsUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  it('back closes a sheet first, then leaves a module, then goes home, then lets the system handle it', async () => {
    await renderApp();
    openModule(MODULES.find((m) => m.module === 'languages')!);
    addEntry(MODULES.find((m) => m.module === 'languages')!);
    fireEvent.click(enumButton('熟练程度'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    let handled = false;
    await waitFor(() => {
      handled = device.pressBack();
    });
    expect(handled).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(device.pressBack()).toBe(true);
    await screen.findByRole('heading', { level: 1, name: '简历资料' });
    expect(device.pressBack()).toBe(true);
    await screen.findByRole('heading', { level: 1, name: '首页' });
    expect(device.pressBack()).toBe(false);
  });

  it('saves at once when the app goes to the background', async () => {
    await renderApp(makeProfile(), 60_000);
    openModule(MODULES.find((m) => m.module === 'basics')!);
    type('名', '小明');
    device.pause();
    await until((r) => expect(r.basics.givenName).toBe('小明'));
  });
});
