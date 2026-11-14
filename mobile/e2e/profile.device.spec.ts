// The app on a real Android WebView: every field of every module is filled through the page, the app is killed, and
// every value must come back from the encrypted file. Plus: a quick edit survives Home + kill, the on-screen keyboard
// does not cover the field being typed in, onboarding runs once, export and import round-trip (plain and with a
// password), delete all leaves nothing behind, the back key order, recent pages are encrypted, and 200% font scale.
// Resume import: a PDF opened with the app and a Word file shared to it (through the manifest's intent filters), a
// stored attachment read back, files it cannot read, and the review at 200% font scale and in dark mode.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _android, expect, test, type AndroidDevice, type Page } from '@playwright/test';
import { MODULES, enumOptions, exportProfile, type FieldMeta, type ModuleMeta } from '../../src/editor';
import { translate } from '../../src/i18n';
// The export pieces, not transfer.ts's buildExport: that one pulls in the page's icons (svg?raw), which Node cannot load.
import { encryptExport } from '../app/src/data/exportCrypto';
import { mt } from '../app/src/i18n';
import { ProfileSchema, ResumeSchema } from '../../src/schema';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APK = path.join(HERE, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const PKG = 'app.raf.dev';
const zh = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
/** The app's own words (mobile/app/src/i18n.ts), in Chinese. */
const mzh = (key: string, params?: Record<string, string | number>) => mt('zh', key, params);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EDITABLE = MODULES.filter((m) => m.container !== 'attachments');
const REGION_PARTS = ['province', 'city', 'district'] as const;

let device: AndroidDevice;

test.beforeAll(async () => {
  const serial = process.env.RAF_SERIAL;
  if (!serial) throw new Error('set RAF_SERIAL');
  // Every test starts with `pm clear`, which deletes the app's resume data. Never on a real phone by accident.
  if (!serial.startsWith('emulator-') && process.env.RAF_ALLOW_WIPE !== '1') {
    throw new Error(`${serial} is not an emulator: these tests wipe the app's data. Set RAF_ALLOW_WIPE=1 to run anyway.`);
  }
  const found = (await _android.devices()).find((d) => d.serial() === serial);
  if (!found) throw new Error(`adb device ${serial} not found`);
  device = found;
  await device.installApk(APK);
});

test.afterAll(async () => {
  await device?.close();
});

/** Start the app; it shows onboarding on a first run, Home otherwise. */
async function launch(): Promise<Page> {
  await device.shell(`am force-stop ${PKG}`);
  await device.shell(`am start -n ${PKG}/.MainActivity`);
  const page = await (await device.webView({ pkg: PKG })).page();
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  return page;
}

const WELCOME = '你好，先说三件事';

/** Fresh app data, Chinese interface, through onboarding to one Chinese resume on the 简历 tab. */
async function freshResume(): Promise<Page> {
  await device.shell(`pm clear ${PKG}`);
  const page = await launch();
  await expect(page.getByRole('heading', { level: 1, name: /^(你好，先说三件事|Hi! Three things first)$/ })).toBeVisible();
  await page.getByRole('radio', { name: '中' }).click();
  await startBlank(page);
  return page;
}

/** Onboarding, welcome step in Chinese: continue, start from scratch, new Chinese resume. */
async function startBlank(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: WELCOME })).toBeVisible();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.getByRole('button', { name: /^从空白开始/ }).click();
  await page.getByRole('button', { name: '新建中文简历', exact: true }).click();
  await expect(page.getByRole('list', { name: '简历模块' })).toBeVisible();
}

const tabButton = (page: Page, name: '首页' | '简历' | '设置') =>
  page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true });

async function toTab(page: Page, name: '首页' | '简历' | '设置') {
  const tab = tabButton(page, name);
  if ((await tab.getAttribute('aria-current')) !== 'page') await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
}

const moduleButton = (page: Page, meta: ModuleMeta) =>
  page.getByRole('button', { name: new RegExp(`^${esc(zh(meta.labelKey))}`) });

async function openModule(page: Page, meta: ModuleMeta) {
  // After a relaunch the app opens on Home: the module list is on the 简历 tab.
  if (!(await page.getByRole('list', { name: '简历模块' }).isVisible())) {
    await toTab(page, '简历');
    await expect(page.getByRole('list', { name: '简历模块' })).toBeVisible();
  }
  await moduleButton(page, meta).click();
  await expect(page.getByRole('heading', { level: 1, name: zh(meta.labelKey) })).toBeVisible();
}

async function backToList(page: Page) {
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page.getByRole('list', { name: '简历模块' })).toBeVisible();
}

/** The value each field gets, unique per module and field so that crossed wires show. */
function planned(meta: ModuleMeta, field: FieldMeta, n: number) {
  const tag = `${meta.module}-${field.key}`.replace(/\./g, '-');
  switch (field.input) {
    case 'number':
      return String(10 + n);
    case 'date':
      return `2024-0${(n % 9) + 1}-1${n % 10}`;
    case 'month':
      return field.currentKey ? '2026-06' : `2023-0${(n % 9) + 1}`;
    case 'textarea':
      return `第一行 ${tag}\nline two`;
    case 'list':
      return [`${tag}-a`, `${tag}-b`];
    case 'region':
      return REGION_PARTS.map((p) => `${tag}-${p}`);
    case 'select': {
      const options = enumOptions(field.enumDomain ?? '', 'zh');
      return options[options.length - 1]!.label; // the last choice: never the default
    }
    case 'bool':
      return '是';
    default:
      return `${tag}@x`;
  }
}

async function fillField(page: Page, meta: ModuleMeta, field: FieldMeta, n: number) {
  const label = zh(field.labelKey);
  const value = planned(meta, field, n);
  switch (field.input) {
    case 'select':
      await page.getByRole('button', { name: new RegExp(`^${esc(label)}`) }).click();
      await page.getByRole('dialog', { name: label }).getByRole('radio', { name: value as string, exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      return;
    case 'bool':
      await page.getByRole('radiogroup', { name: label }).getByRole('radio', { name: '是' }).click();
      return;
    case 'list': {
      const input = page.getByRole('textbox', { name: label, exact: true });
      await input.fill((value as string[]).join('，'));
      await page.getByRole('button', { name: `添加${label}`, exact: true }).click();
      return;
    }
    case 'region':
      for (const [i, part] of REGION_PARTS.entries()) {
        await page.getByLabel(`${label} – ${zh(`options.region.${part}`)}`, { exact: true }).fill((value as string[])[i]!);
      }
      return;
    default:
      await page.getByLabel(label, { exact: true }).fill(value as string);
  }
}

async function readBack(page: Page, meta: ModuleMeta, field: FieldMeta, n: number) {
  const label = zh(field.labelKey);
  const value = planned(meta, field, n);
  const where = `${meta.module}.${field.key}`;
  switch (field.input) {
    case 'select':
      await expect(page.getByRole('button', { name: new RegExp(`^${esc(label)}`) }), where).toContainText(value as string);
      return;
    case 'bool':
      await expect(page.getByRole('radiogroup', { name: label }).getByRole('radio', { name: '是' }), where).toHaveAttribute('aria-checked', 'true');
      return;
    case 'list':
      for (const item of value as string[]) await expect(page.getByRole('button', { name: `删除${item}` }), where).toBeVisible();
      return;
    case 'region':
      for (const [i, part] of REGION_PARTS.entries()) {
        await expect(page.getByLabel(`${label} – ${zh(`options.region.${part}`)}`, { exact: true }), where).toHaveValue((value as string[])[i]!);
      }
      return;
    default:
      await expect(page.getByLabel(label, { exact: true }), where).toHaveValue(value as string);
  }
}

test('every field of every module is saved on the phone and comes back after the app is killed', async () => {
  let page = await freshResume();
  for (const meta of EDITABLE) {
    await openModule(page, meta);
    if (meta.repeatable) await page.getByRole('button', { name: zh('options.add', { name: zh(meta.labelKey) }) }).click();
    for (const [n, field] of meta.fields.entries()) await fillField(page, meta, field, n);
    await expect(page.getByText(zh('options.allSaved'))).toBeVisible();
    await backToList(page);
  }

  page = await launch();
  for (const meta of EDITABLE) {
    await openModule(page, meta);
    if (meta.repeatable) {
      // One entry, folded after a relaunch only when there are several; open it if needed.
      const toggle = page.getByRole('button', { name: new RegExp(`^${esc(zh('options.entry', { name: zh(meta.labelKey), n: 1 }))}`) });
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    }
    for (const [n, field] of meta.fields.entries()) await readBack(page, meta, field, n);
    await backToList(page);
  }
});

const ATTACHMENTS = MODULES.find((m) => m.container === 'attachments')!;
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Raw bytes of a file in the app's private folder. */
async function privateFile(name: string): Promise<Buffer> {
  return device.shell(`run-as ${PKG} cat files/attachments/${name}`);
}

test('attachments are stored encrypted, come back after a kill, and are cleared from the phone once deleted', async () => {
  let page = await freshResume();
  await openModule(page, ATTACHMENTS);
  const marker = `RAF-MARKER-${Date.now()}`;
  const resumeLabel = zh('options.attach.resume');
  const photoLabel = zh('options.attach.photo');
  await page.getByLabel(`${resumeLabel} – 选择文件`).setInputFiles({
    name: '示例简历.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n% ${marker}\n%%EOF\n`),
  });
  await page.getByLabel(`${photoLabel} – 选择文件`).setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1X1, 'base64') });
  await expect(page.getByText('示例简历.pdf')).toBeVisible();
  const thumb = page.getByRole('img', { name: 'face.png' });
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1);
  await expect(page.getByText(zh('options.allSaved'))).toBeVisible();

  // On disk: a .meta and a .data file per attachment, none of them carrying the name or the contents in the clear.
  const names = (await device.shell(`run-as ${PKG} ls files/attachments`)).toString().split(/\s+/).filter(Boolean).sort();
  expect(names).toHaveLength(4);
  expect(names.filter((n) => n.endsWith('.meta'))).toHaveLength(2);
  for (const name of names) {
    const raw = await privateFile(name);
    expect(raw.includes(Buffer.from(marker)), name).toBe(false);
    expect(raw.includes(Buffer.from('示例简历')), name).toBe(false);
    expect(raw.includes(Buffer.from('%PDF')), name).toBe(false);
    expect(raw[0], `${name} format byte`).toBe(1);
  }

  page = await launch();
  await openModule(page, ATTACHMENTS);
  await expect(page.getByText('示例简历.pdf')).toBeVisible();
  await expect(page.getByRole('img', { name: 'face.png' })).toBeVisible();

  // Delete the resume PDF, do not undo: after the undo window its two files leave the phone.
  await page.getByRole('button', { name: `更多操作：${resumeLabel}` }).click();
  await page.getByRole('dialog', { name: resumeLabel }).getByRole('button', { name: '删除' }).click();
  await expect(page.getByLabel(`${resumeLabel} – 选择文件`)).toBeAttached();
  await expect
    .poll(async () => (await device.shell(`run-as ${PKG} ls files/attachments`)).toString().split(/\s+/).filter(Boolean).length, { timeout: 20_000 })
    .toBe(2);
});

test('an edit made just before Home survives the app being killed', async () => {
  let page = await freshResume();
  const basics = EDITABLE.find((m) => m.module === 'basics')!;
  await openModule(page, basics);
  await page.getByLabel('名', { exact: true }).fill('快手');
  await device.shell('input keyevent 3'); // Home, well inside the 500 ms autosave delay
  await new Promise((r) => setTimeout(r, 1500));
  page = await launch();
  await openModule(page, basics);
  await expect(page.getByLabel('名', { exact: true })).toHaveValue('快手');
});

test('a profile left only as the backup file of an interrupted save is still read', async () => {
  let page = await freshResume();
  const basics = EDITABLE.find((m) => m.module === 'basics')!;
  await openModule(page, basics);
  await page.getByLabel('名', { exact: true }).fill('备份');
  await expect(page.getByText(zh('options.allSaved'))).toBeVisible();
  await device.shell(`am force-stop ${PKG}`);
  // What Android 10's AtomicFile leaves when the app dies between renaming the old file and writing the new one.
  await device.shell(`run-as ${PKG} mv files/profile.enc files/profile.enc.bak`);
  page = await launch();
  await openModule(page, basics);
  await expect(page.getByLabel('名', { exact: true })).toHaveValue('备份');
});

test('the keyboard does not cover the field being typed in', async () => {
  const page = await freshResume();
  await openModule(page, EDITABLE.find((m) => m.module === 'basics')!);
  const last = page.getByLabel('现居地 – 区 / 县', { exact: true });
  // Put the field in the lower part of the screen, where the keyboard will come up.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const before = await page.evaluate(() => window.innerHeight);
  const box = (await last.boundingBox())!;
  expect(box.y, 'field starts in the lower half').toBeGreaterThan(before / 2);
  // A real tap gesture (a CDP mouse click does not raise the on-screen keyboard).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizeTapGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, gestureSourceType: 'touch' });
  await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 10_000, message: 'keyboard shrinks the WebView' }).toBeLessThan(before * 0.8);
  await new Promise((r) => setTimeout(r, 1000));
  const visible = await last.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { focused: document.activeElement === el, top: rect.top, bottom: rect.bottom, viewBottom: Math.min(window.innerHeight, window.visualViewport!.height) };
  });
  expect(visible.focused, JSON.stringify(visible)).toBe(true);
  expect(visible.top, JSON.stringify(visible)).toBeGreaterThanOrEqual(0);
  expect(visible.bottom, JSON.stringify(visible)).toBeLessThanOrEqual(visible.viewBottom);

  // Hide the keyboard with Back (the field keeps focus), scroll it low again, and tap the same field again.
  await device.shell('input keyevent 4');
  await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 10_000 }).toBe(before);
  await expect.poll(() => last.evaluate((el) => document.activeElement === el)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const again = (await last.boundingBox())!;
  await cdp.send('Input.synthesizeTapGesture', { x: again.x + again.width / 2, y: again.y + again.height / 2, gestureSourceType: 'touch' });
  await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 10_000 }).toBeLessThan(before * 0.8);
  await new Promise((r) => setTimeout(r, 1000));
  const second = await last.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewBottom: Math.min(window.innerHeight, window.visualViewport!.height) };
  });
  expect(second.top, `second tap ${JSON.stringify(second)}`).toBeGreaterThanOrEqual(0);
  expect(second.bottom, `second tap ${JSON.stringify(second)}`).toBeLessThanOrEqual(second.viewBottom);
});

// ------------------------------------------------------------------ shell, onboarding, data

const RESULTS = path.join(HERE, 'results');
const BASICS = EDITABLE.find((m) => m.module === 'basics')!;
const CONTACT = EDITABLE.find((m) => m.module === 'contact')!;

/** File names directly in a folder of the app's private storage. */
async function privateFiles(dir = 'files'): Promise<string[]> {
  return (await device.shell(`run-as ${PKG} ls ${dir} 2>/dev/null`)).toString().split(/\s+/).filter(Boolean);
}

/** The Android back key, sent through adb (device.input needs Playwright's driver app, which is not installed). */
async function pressBack() {
  await device.shell('input keyevent KEYCODE_BACK');
}

/** The app is the one in front. */
async function inFront(): Promise<boolean> {
  return (await device.shell('dumpsys activity activities | grep -i resumedactivity')).toString().includes(PKG);
}

/** Settings → delete all → 永久删除; the app returns to onboarding, in the phone's language (the settings are gone). */
async function deleteAllData(page: Page) {
  await toTab(page, '设置');
  await page.getByRole('button', { name: /^删除这台手机上的全部数据/ }).click();
  const sheet = page.getByRole('dialog', { name: '删除全部数据？' });
  await sheet.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^(你好，先说三件事|Hi! Three things first)$/ })).toBeVisible({ timeout: 15_000 });
}

/** Delete all, then switch onboarding to Chinese again (which saves a fresh, empty profile under a new key). */
async function deleteAll(page: Page) {
  await deleteAllData(page);
  await page.getByRole('radio', { name: '中' }).click();
  await expect(page.getByRole('heading', { level: 1, name: WELCOME })).toBeVisible();
}

/** Onboarding step 2 with a file handed to the hidden import input (no system picker needed). */
async function importDuringOnboarding(page: Page, file: { name: string; buffer: Buffer }, password?: { wrong: string; right: string }) {
  await expect(page.getByRole('heading', { level: 1, name: WELCOME })).toBeVisible();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '准备好你的简历' })).toBeVisible();
  await page.locator('input[type="file"][aria-label="从文件导入"]').setInputFiles({ ...file, mimeType: 'application/json' });
  if (password) {
    const sheet = page.getByRole('dialog', { name: '这个文件有密码' });
    await sheet.getByLabel('密码', { exact: true }).fill(password.wrong);
    await sheet.getByRole('button', { name: '解锁', exact: true }).click();
    await expect(sheet.getByText('密码不对，或者文件已损坏。')).toBeVisible({ timeout: 30_000 });
    await sheet.getByLabel('密码', { exact: true }).fill(password.right);
    await sheet.getByRole('button', { name: '解锁', exact: true }).click();
  }
  const preview = page.getByRole('dialog', { name: '文件里有什么' });
  await expect(preview.getByText('1 份简历')).toBeVisible({ timeout: 30_000 });
  await preview.getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '首页' })).toBeVisible();
}

async function expectNameBack(page: Page) {
  await openModule(page, BASICS);
  await expect(page.getByLabel('姓', { exact: true })).toHaveValue('张');
  await expect(page.getByLabel('名', { exact: true })).toHaveValue('三');
  await backToList(page);
}

/** A resume with 姓 张, 名 三 and an example.com email, typed through the page. */
async function fillSample(page: Page) {
  await openModule(page, BASICS);
  await page.getByLabel('姓', { exact: true }).fill('张');
  await page.getByLabel('名', { exact: true }).fill('三');
  await backToList(page);
  await openModule(page, CONTACT);
  await page.getByLabel(zh('options.field.email'), { exact: true }).fill('zhangsan@example.com');
  await expect(page.getByText(zh('options.allSaved'))).toBeVisible();
  await backToList(page);
}

interface UiNode {
  pkg: string;
  res: string;
  text: string;
  x: number;
  y: number;
}

/** The on-screen views of whatever app is in front, read with uiautomator (no Playwright driver app needed). */
async function systemUiNodes(): Promise<UiNode[]> {
  const xml = (await device.shell('uiautomator dump /sdcard/raf-ui.xml >/dev/null 2>&1; cat /sdcard/raf-ui.xml')).toString('utf8');
  const nodes: UiNode[] = [];
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(match[0])?.[1] ?? '';
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr('bounds'));
    if (!bounds) continue;
    const [x1, y1, x2, y2] = bounds.slice(1).map(Number) as [number, number, number, number];
    nodes.push({ pkg: attr('package'), res: attr('resource-id'), text: attr('text'), x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) });
  }
  return nodes;
}

/** Wait for a view of the system UI (the document picker) and tap it with `input tap`. */
async function tapInSystemUi(match: (node: UiNode) => boolean, what: string, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const node = (await systemUiNodes()).find(match);
    if (node) {
      await device.shell(`input tap ${node.x} ${node.y}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${what} did not appear`);
}

/** Settings → export, driving the system "create document" picker to save into Downloads. Returns the saved file. */
async function exportThroughPicker(page: Page, password?: string): Promise<{ name: string; buffer: Buffer }> {
  await device.shell('rm -f /sdcard/Download/resume-autofill-profile-*');
  await toTab(page, '设置');
  await page.getByRole('button', { name: /^导出全部数据/ }).click();
  const sheet = page.getByRole('dialog', { name: '导出全部数据' });
  if (password) {
    await sheet.getByRole('checkbox', { name: '用密码加密这个文件' }).check();
    await sheet.getByLabel('密码', { exact: true }).fill(password);
    await sheet.getByLabel('再输一次密码', { exact: true }).fill(password);
  }
  await sheet.getByRole('button', { name: '导出文件', exact: true }).click();
  await tapInSystemUi(
    (node) => node.pkg.includes('documentsui') && (node.res === 'android:id/button1' || /^(SAVE|Save|保存)$/.test(node.text)),
    'the picker save button',
  );
  await expect(page.getByText('已导出')).toBeVisible({ timeout: 30_000 });
  const listed = (await device.shell('ls /sdcard/Download')).toString().split(/\s+/).filter((n) => n.startsWith('resume-autofill-profile-'));
  expect(listed, 'exported file in Downloads').toHaveLength(1);
  const name = listed[0]!;
  return { name, buffer: await device.shell(`cat /sdcard/Download/${name}`) };
}

test('first run: onboarding once, start blank lands on the resume page, and a restart opens Home', async () => {
  await device.shell(`pm clear ${PKG}`);
  let page = await launch();
  await page.getByRole('radio', { name: '中' }).click();
  await expect(page.getByRole('heading', { level: 1, name: WELCOME })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: '三个承诺' }).getByRole('listitem')).toHaveCount(3);
  await startBlank(page);
  await expect(tabButton(page, '简历')).toHaveAttribute('aria-current', 'page');

  page = await launch();
  await expect(page.getByRole('heading', { level: 1, name: '首页' })).toBeVisible();
  await expect(page.getByRole('heading', { name: WELCOME })).toHaveCount(0);
});

test('export and import round trip, plain and with a password, through the system picker', async () => {
  try {
    let page = await freshResume();
    await fillSample(page);

    const plain = await exportThroughPicker(page);
    expect(JSON.parse(plain.buffer.toString('utf8')).resumes[0].basics.familyName).toBe('张');
    await deleteAll(page);
    await importDuringOnboarding(page, plain);
    await expectNameBack(page);

    page = await launch();
    const locked = await exportThroughPicker(page, 'example-pass-123');
    const text = locked.buffer.toString('utf8');
    expect(JSON.parse(text).format).toBe('resume-autofill-encrypted');
    expect(text.includes('张')).toBe(false);
    expect(text.includes('example.com')).toBe(false);
    await deleteAll(page);
    await importDuringOnboarding(page, locked, { wrong: 'wrong-pass-000', right: 'example-pass-123' });
    await expectNameBack(page);
  } finally {
    await device.shell('rm -f /sdcard/Download/resume-autofill-profile-*');
  }
});

test('import round trip with files built in Node (no system picker), plain and with a password', async () => {
  const profile = ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [ResumeSchema.parse({ id: 'r1', title: '示例简历', locale: 'zh-CN', basics: { familyName: '张', givenName: '三' } })],
    activeResumeId: 'r1',
    settings: { uiLanguage: 'zh' },
  });
  const plain = { name: 'resume-autofill-profile-node.json', text: exportProfile(profile) };
  const locked = { name: 'resume-autofill-profile-node-encrypted.json', text: await encryptExport(plain.text, 'example-pass-123') };

  await device.shell(`pm clear ${PKG}`);
  let page = await launch();
  await page.getByRole('radio', { name: '中' }).click();
  await importDuringOnboarding(page, { name: plain.name, buffer: Buffer.from(plain.text) });
  await expectNameBack(page);

  page = await launch();
  await deleteAll(page);
  await importDuringOnboarding(page, { name: locked.name, buffer: Buffer.from(locked.text) }, { wrong: 'wrong-pass-000', right: 'example-pass-123' });
  await expectNameBack(page);
});

test('delete all removes the encrypted files and the key', async () => {
  let page = await freshResume();
  await fillSample(page);
  await openModule(page, ATTACHMENTS);
  await page.getByLabel(`${zh('options.attach.resume')} – 选择文件`).setInputFiles({
    name: '示例简历.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
  });
  await expect(page.getByText('示例简历.pdf')).toBeVisible();
  await expect(page.getByText(zh('options.allSaved'))).toBeVisible();
  await backToList(page);
  await toTab(page, '首页');
  await page.getByLabel('网申链接').fill('https://jobs.example.com/apply/1');
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await expect(page.getByRole('list', { name: '最近的网申页面' })).toContainText('jobs.example.com');
  await expect.poll(() => privateFiles()).toEqual(expect.arrayContaining(['profile.enc', 'state.enc', 'attachments']));

  await deleteAllData(page);
  const left = await privateFiles();
  expect(left).not.toContain('profile.enc');
  // Onboarding has started again and may already have stored its fresh state under a new key; never the old data.
  if (left.includes('attachments')) expect(await privateFiles('files/attachments')).toEqual([]);
  if (left.includes('state.enc')) {
    const raw = await device.shell(`run-as ${PKG} cat files/state.enc`);
    expect(raw.includes(Buffer.from('jobs.example.com'))).toBe(false);
  }

  // A fresh key works: a new resume is saved and read back after a kill.
  await page.getByRole('radio', { name: '中' }).click();
  await startBlank(page);
  await openModule(page, BASICS);
  await page.getByLabel('名', { exact: true }).fill('新');
  await expect(page.getByText(zh('options.allSaved'))).toBeVisible();
  page = await launch();
  await openModule(page, BASICS);
  await expect(page.getByLabel('名', { exact: true })).toHaveValue('新');
});

test('the back key: sheet, module, home, then out', async () => {
  const page = await freshResume();
  const languages = EDITABLE.find((m) => m.module === 'languages')!;
  await openModule(page, languages);
  await page.getByRole('button', { name: zh('options.add', { name: zh(languages.labelKey) }) }).click();
  await page.getByRole('button', { name: /^熟练程度/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await pressBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await pressBack();
  await expect(page.getByRole('list', { name: '简历模块' })).toBeVisible();
  await pressBack();
  await expect(page.getByRole('heading', { level: 1, name: '首页' })).toBeVisible();
  await pressBack();
  await expect.poll(inFront, { timeout: 10_000 }).toBe(false);
});

test('recent pages survive a restart and are not stored in plain text', async () => {
  let page = await freshResume();
  await toTab(page, '首页');
  await page.getByLabel('网申链接').fill('https://jobs.example.com/apply/1');
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await expect(page.getByRole('list', { name: '最近的网申页面' })).toContainText('jobs.example.com');

  page = await launch();
  await expect(page.getByRole('heading', { level: 1, name: '首页' })).toBeVisible();
  await expect(page.getByRole('list', { name: '最近的网申页面' })).toContainText('jobs.example.com');
  const raw = await device.shell(`run-as ${PKG} cat files/state.enc`);
  expect(raw.length).toBeGreaterThan(0);
  expect(raw.includes(Buffer.from('jobs.example.com'))).toBe(false);
  expect(raw.includes(Buffer.from('apply'))).toBe(false);
});

/** No sideways scroll, no clipped tab label, and every visible button at least 44px tall. */
async function expectFits(page: Page, where: string) {
  const report = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      clippedTabs: [...document.querySelectorAll('.m-tab')].filter((el) => el.scrollHeight > el.clientHeight + 1).map((el) => el.textContent),
      small: [...document.querySelectorAll('button, .m-picker')]
        .filter((el) => visible(el) && el.getBoundingClientRect().height < 43.5)
        .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)),
    };
  });
  expect(report.overflow, `${where}: horizontal scroll`).toBeLessThanOrEqual(0);
  expect(report.clippedTabs, `${where}: clipped tab labels`).toEqual([]);
  expect(report.small, `${where}: buttons under 44px`).toEqual([]);
}

test('at 200% font scale nothing is cut off; light and dark screenshots for a human look', async () => {
  mkdirSync(RESULTS, { recursive: true });
  try {
    await device.shell(`pm clear ${PKG}`);
    await device.shell('settings put system font_scale 2.0');
    let page = await launch();
    await page.getByRole('radio', { name: '中' }).click();
    await expect(page.getByRole('heading', { level: 1, name: WELCOME })).toBeVisible();
    await expectFits(page, 'onboarding welcome');
    await startBlank(page);
    await toTab(page, '首页');
    await expect(page.getByRole('heading', { level: 1, name: '首页' })).toBeVisible();
    await expectFits(page, 'home');
    await toTab(page, '设置');
    await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
    await expectFits(page, 'settings');
    await page.getByRole('button', { name: /^导出全部数据/ }).click();
    await expect(page.getByRole('dialog', { name: '导出全部数据' })).toBeVisible();
    await expectFits(page, 'export sheet');

    await device.shell('settings put system font_scale 1.0');
    for (const mode of ['no', 'yes'] as const) {
      await device.shell(`cmd uimode night ${mode}`);
      page = await launch();
      // Playwright emulates a light colour scheme by default; turn that off so the page sees the phone's setting.
      await page.emulateMedia({ colorScheme: null });
      await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(mode === 'yes');
      const look = mode === 'yes' ? 'dark' : 'light';
      await toTab(page, '首页');
      await page.screenshot({ path: path.join(RESULTS, `home-${look}.png`) });
      await toTab(page, '设置');
      await page.screenshot({ path: path.join(RESULTS, `settings-${look}.png`) });
    }
  } finally {
    await device.shell('settings put system font_scale 1.0');
    await device.shell('cmd uimode night no');
  }
});

// ---- Resume import: open with, share, a stored attachment, files it cannot read, 200% and dark ----

const IMPORT_FIXTURES = path.join(HERE, '..', '..', 'tests', 'unit', 'mobile', 'fixtures', 'import');
const RESUME_SAMPLES = path.join(HERE, '..', '..', 'fixtures', 'resume-samples');
const MIME_PDF = 'application/pdf';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const REVIEW_TITLE = '核对导入的内容';

/**
 * Puts a file in the app's own cache (after `pm clear`) and returns its content URI through the app's FileProvider
 * (`cache-path name="my_cache_images" path="."`). The name must be plain ASCII: it goes into a shell command and a URI.
 */
async function pushToAppCache(local: string | Buffer, name: string): Promise<string> {
  const tmp = `/data/local/tmp/raf-${name}`;
  await device.push(typeof local === 'string' ? readFileSync(local) : local, tmp);
  try {
    await device.shell(`cat ${tmp} | run-as ${PKG} sh -c 'mkdir -p cache/incoming-test && cat > cache/incoming-test/${name}'`);
  } finally {
    await device.shell(`rm -f ${tmp}`);
  }
  return `content://${PKG}.fileprovider/my_cache_images/incoming-test/${name}`;
}

/** "Open with": ACTION_VIEW resolved through the manifest's filters to this app, without a chooser. */
async function openWith(uri: string, mime: string) {
  await device.shell(`am start -a android.intent.action.VIEW -d ${uri} -t ${mime} --grant-read-uri-permission -p ${PKG}`);
}

/** "Share": ACTION_SEND with the file as EXTRA_STREAM. */
async function shareTo(uri: string, mime: string) {
  await device.shell(
    `am start -a android.intent.action.SEND -t ${mime} --eu android.intent.extra.STREAM ${uri} --grant-read-uri-permission -p ${PKG}`,
  );
}

async function airplane(on: boolean) {
  await device.shell(`cmd connectivity airplane-mode ${on ? 'enable' : 'disable'}`);
}

const importDialog = (page: Page, title: string | RegExp = REVIEW_TITLE) => page.getByRole('dialog', { name: title });

/** The review's primary action: 导入 n 项 or 合并 n 项. */
const primaryAction = (page: Page, verb: '导入' | '合并') =>
  importDialog(page).getByRole('button', { name: new RegExp(`^${verb} \\d+ 项$`) });

/** Fresh data, the interface switched to Chinese on onboarding's first step, and the app stopped there. */
async function chineseOnboardingStopped() {
  await device.shell(`pm clear ${PKG}`);
  const page = await launch();
  await page.getByRole('radio', { name: '中' }).click();
  await expect(page.getByRole('heading', { level: 1, name: WELCOME })).toBeVisible();
  // The language is stored with the first save; give it time before the process goes.
  await expect.poll(() => privateFiles(), { timeout: 15_000 }).toContain('profile.enc');
  await device.shell(`am force-stop ${PKG}`);
}

test('open with: a Chinese PDF opened from another app, cold start in airplane mode, is reviewed and imported as a new resume', async () => {
  try {
    await chineseOnboardingStopped();
    await airplane(true);
    const uri = await pushToAppCache(path.join(IMPORT_FIXTURES, 'zh-zhangsan-3pages.pdf'), 'zh-zhangsan-3pages.pdf');
    const started = Date.now();
    await openWith(uri, MIME_PDF);
    let page = await (await device.webView({ pkg: PKG })).page();
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    const workers = new Set(page.workers().map((w) => w.url()));
    page.on('worker', (worker) => workers.add(worker.url()));

    const review = importDialog(page);
    await expect(review.getByRole('heading', { level: 1, name: REVIEW_TITLE })).toBeVisible({ timeout: 60_000 });
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: 'intent to review (ms)', description: String(elapsed) });
    console.log(`D1: intent to review heading ${elapsed} ms`);
    for (const w of page.workers()) workers.add(w.url());
    expect([...workers].some((url) => url.endsWith('/pdfjs/pdf.worker.min.mjs')), [...workers].join(', ')).toBe(true);

    await expect(review.getByLabel('姓', { exact: true })).toHaveValue('张');
    await expect(review.getByLabel('名', { exact: true })).toHaveValue('三');
    await expect(review.getByText(/^认出 \d+ 项/)).toBeVisible();
    await expect(review.getByRole('radio', { name: '新建一份简历' })).toBeChecked();
    await expect(review.getByRole('radio', { name: mzh('m.lang.zh'), exact: true })).toBeChecked();
    await primaryAction(page, '导入').click();

    await expect(importDialog(page)).toHaveCount(0);
    await expect(tabButton(page, '简历')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('list', { name: '简历模块' })).toBeVisible();
    await openModule(page, BASICS);
    await expect(page.getByLabel('姓', { exact: true })).toHaveValue('张');
    await expect(page.getByLabel('名', { exact: true })).toHaveValue('三');
    await expect(page.getByText(zh('options.allSaved'))).toBeVisible();

    const seen = [...requests];
    page = await launch();
    await expect(page.getByRole('heading', { name: WELCOME })).toHaveCount(0);
    await openModule(page, BASICS);
    await expect(page.getByLabel('姓', { exact: true })).toHaveValue('张');
    await expect(page.getByLabel('名', { exact: true })).toHaveValue('三');

    const offsite = seen.filter((url) => !/^(https:\/\/localhost\/|blob:|data:)/.test(url));
    expect(offsite, 'requests outside the app').toEqual([]);
  } finally {
    await airplane(false);
  }
});

test('share: a Word file shared to the app merges into the current resume, fills only empty fields, and undo puts it back', async () => {
  const page = await freshResume();
  await openModule(page, BASICS);
  await page.getByLabel('姓', { exact: true }).fill('李');
  await expect(page.getByText(zh('options.allSaved'))).toBeVisible();
  await backToList(page);

  const uri = await pushToAppCache(path.join(IMPORT_FIXTURES, 'zh-zhangsan.docx'), 'zh-zhangsan.docx');
  await shareTo(uri, MIME_DOCX);
  const review = importDialog(page);
  await expect(review.getByRole('heading', { level: 1, name: REVIEW_TITLE })).toBeVisible({ timeout: 60_000 });
  // The resume is not blank, so a new one is the default.
  await expect(review.getByRole('radio', { name: '新建一份简历' })).toBeChecked();
  await review.getByRole('radio', { name: `合并到「${mzh('m.defaultTitle.zh')}」` }).check();
  await expect(review.getByText('现有：李')).toBeVisible();
  await expect(review.getByRole('checkbox', { name: '覆盖：姓' })).not.toBeChecked();
  await primaryAction(page, '合并').click();

  const preview = page.getByRole('dialog', { name: '合并前看一下' });
  await expect(preview.getByText(/^填入空着的 \d+ 项/)).toBeVisible();
  await preview.getByRole('button', { name: '确认合并', exact: true }).click();
  await expect(importDialog(page)).toHaveCount(0);

  // The toast's 撤销 stays for 8 s: check what was merged quickly, then undo.
  await openModule(page, BASICS);
  await expect(page.getByLabel('姓', { exact: true })).toHaveValue('李');
  await expect(page.getByLabel('名', { exact: true })).toHaveValue('三');
  await backToList(page);
  await openModule(page, CONTACT);
  const email = page.getByLabel(zh('options.field.email'), { exact: true });
  await expect(email).toHaveValue('zhangsan@example.com');
  await page.getByRole('button', { name: zh('options.undo'), exact: true }).click();
  await expect(page.getByText('已撤销导入')).toBeVisible();
  await expect(email).toHaveValue('');
  await backToList(page);
  await openModule(page, BASICS);
  await expect(page.getByLabel('姓', { exact: true })).toHaveValue('李');
  await expect(page.getByLabel('名', { exact: true })).toHaveValue('');
});

test('open with, then leaving with back: the intent redelivered from Recents is not imported again', async () => {
  const page = await freshResume();
  const uri = await pushToAppCache(path.join(IMPORT_FIXTURES, 'zh-zhangsan.docx'), 'zh-zhangsan.docx');
  await openWith(uri, MIME_DOCX);
  const review = importDialog(page);
  await expect(review.getByRole('heading', { level: 1, name: REVIEW_TITLE })).toBeVisible({ timeout: 60_000 });
  await review.getByRole('button', { name: zh('common.cancel'), exact: true }).click();
  await expect(importDialog(page)).toHaveCount(0);
  for (let i = 0; i < 4 && (await inFront()); i += 1) {
    await pressBack();
    await new Promise((r) => setTimeout(r, 700));
  }
  await expect.poll(inFront, { timeout: 10_000 }).toBe(false);

  // Recents starts the activity again with its original intent plus FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY (0x00100000).
  await device.shell(`am start -a android.intent.action.VIEW -d ${uri} -t ${MIME_DOCX} -f 0x00100000 --grant-read-uri-permission -p ${PKG}`);
  // The process lives on, so Playwright keeps the closed page of the finished activity; read the screen instead.
  const appTexts = async () => (await systemUiNodes()).filter((n) => n.pkg === PKG && n.text).map((n) => n.text);
  await expect.poll(async () => (await appTexts()).some((t) => /^(首页|简历资料|正在读取简历|核对导入的内容)$/.test(t)), { timeout: 30_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 4_000));
  const shown = await appTexts();
  expect(shown.filter((t) => /正在读取简历|核对导入的内容/.test(t))).toEqual([]);
});

test('attachment: 从这份 PDF 读取简历内容 reads the stored PDF and fills the blank resume', async () => {
  const page = await freshResume();
  await openModule(page, ATTACHMENTS);
  const resumeLabel = zh('options.attach.resume');
  await page.getByLabel(`${resumeLabel} – 选择文件`).setInputFiles({
    name: '示例简历.pdf',
    mimeType: MIME_PDF,
    buffer: readFileSync(path.join(IMPORT_FIXTURES, 'zh-zhangsan.pdf')),
  });
  await expect(page.getByText('示例简历.pdf')).toBeVisible();
  await expect(page.getByText(zh('options.allSaved'))).toBeVisible();

  await page.getByRole('button', { name: '从这份 PDF 读取简历内容' }).click();
  const review = importDialog(page);
  await expect(review.getByRole('heading', { level: 1, name: REVIEW_TITLE })).toBeVisible({ timeout: 60_000 });
  await expect(review.getByRole('radio', { name: `合并到「${mzh('m.defaultTitle.zh')}」` })).toBeChecked();
  await expect(review.getByRole('checkbox', { name: /^同时/ })).toHaveCount(0);
  await primaryAction(page, '合并').click();
  await page.getByRole('dialog', { name: '合并前看一下' }).getByRole('button', { name: '确认合并', exact: true }).click();
  await expect(importDialog(page)).toHaveCount(0);

  await openModule(page, BASICS);
  await expect(page.getByLabel('姓', { exact: true })).toHaveValue('张');
  await expect(page.getByLabel('名', { exact: true })).toHaveValue('三');
  await backToList(page);
  await openModule(page, ATTACHMENTS);
  await expect(page.getByText('示例简历.pdf')).toBeVisible();
  // Still the one stored file (a .meta and a .data), not a second copy.
  expect(await privateFiles('files/attachments')).toHaveLength(2);
});

test('files the app cannot read: a scan, a locked PDF, an 11 MB file and a non-PDF each explain why and store nothing', async () => {
  await device.shell(`pm clear ${PKG}`);
  const page = await launch();
  await page.getByRole('radio', { name: '中' }).click();
  await expect(page.getByRole('heading', { level: 1, name: WELCOME })).toBeVisible();
  await page.getByRole('button', { name: '跳过', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '首页' })).toBeVisible();
  const before = await privateFiles();

  const tooBig = Buffer.alloc(11 * 1024 * 1024, 0x20);
  tooBig.write('%PDF-1.4\n', 0, 'latin1');
  const cases: Array<{ file: string | Buffer; name: string; title: string }> = [
    { file: path.join(RESUME_SAMPLES, 'image-only.pdf'), name: 'image-only.pdf', title: '这份 PDF 是扫描件' },
    { file: path.join(RESUME_SAMPLES, 'encrypted.pdf'), name: 'encrypted.pdf', title: '这份 PDF 设了密码' },
    { file: tooBig, name: 'too-big.pdf', title: '文件超过 10 MB' },
    // Sent as a PDF, but the provider knows it as text: refused by type.
    { file: Buffer.from('plain notes, not a resume\n'), name: 'notes.txt', title: '不是 PDF 或 Word 文件' },
  ];
  for (const { file, name, title } of cases) {
    const uri = await pushToAppCache(file, name);
    await openWith(uri, MIME_PDF);
    const failure = importDialog(page, title);
    await expect(failure.getByRole('heading', { level: 1, name: title }), name).toBeVisible({ timeout: 60_000 });
    await failure.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(importDialog(page, title), name).toHaveCount(0);
  }

  const after = await privateFiles();
  if (after.includes('attachments')) expect(await privateFiles('files/attachments')).toEqual([]);
  // profileInstalled is AndroidX ProfileInstaller's marker, written a few seconds after any launch: not app data.
  const ignored = new Set(['state.enc', 'profile.enc', 'profileInstalled']);
  expect(after.filter((n) => !before.includes(n) && !ignored.has(n))).toEqual([]);
  await toTab(page, '简历');
  await expect(page.getByText(mzh('m.empty'))).toBeVisible();
});

test('the review at 200% font scale and in dark mode: nothing cut off; screenshots for a human look', async () => {
  mkdirSync(RESULTS, { recursive: true });
  try {
    await device.shell(`pm clear ${PKG}`);
    await device.shell('settings put system font_scale 2.0');
    const page = await launch();
    await page.getByRole('radio', { name: '中' }).click();
    await startBlank(page);

    // The three-page file keeps the progress screen up long enough to measure it.
    const uri = await pushToAppCache(path.join(IMPORT_FIXTURES, 'zh-zhangsan-3pages.pdf'), 'zh-zhangsan-3pages.pdf');
    await openWith(uri, MIME_PDF);
    const progress = importDialog(page, '正在读取简历');
    await expect(progress.getByRole('heading', { level: 1, name: '正在读取简历' })).toBeVisible({ timeout: 30_000 });
    await expectFits(page, 'import progress');

    const review = importDialog(page);
    await expect(review.getByRole('heading', { level: 1, name: REVIEW_TITLE })).toBeVisible({ timeout: 60_000 });
    await expectFits(page, 'import review');
    // Playwright emulates a light colour scheme by default; let the page follow the phone instead.
    await page.emulateMedia({ colorScheme: null });
    await page.screenshot({ path: path.join(RESULTS, 'review-light-200.png') });
    await page.screenshot({ path: path.join(RESULTS, 'review-light-200-full.png'), fullPage: true });

    await device.shell('cmd uimode night yes');
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await page.screenshot({ path: path.join(RESULTS, 'review-dark-200.png') });
    await page.screenshot({ path: path.join(RESULTS, 'review-dark-200-full.png'), fullPage: true });
  } finally {
    await device.shell('settings put system font_scale 1.0');
    await device.shell('cmd uimode night no');
  }
});
