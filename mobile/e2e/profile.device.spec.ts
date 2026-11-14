// The profile page on a real Android WebView: every field of every module is filled through the page, the app is
// killed, and every value must come back from the encrypted file. Plus: a quick edit survives Home + kill, and the
// on-screen keyboard does not cover the field being typed in.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _android, expect, test, type AndroidDevice, type Page } from '@playwright/test';
import { MODULES, enumOptions, type FieldMeta, type ModuleMeta } from '../../src/editor';
import { translate } from '../../src/i18n';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APK = path.join(HERE, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const PKG = 'app.raf.dev';
const zh = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
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

async function launch(): Promise<Page> {
  await device.shell(`am force-stop ${PKG}`);
  await device.shell(`am start -n ${PKG}/.MainActivity`);
  const page = await (await device.webView({ pkg: PKG })).page();
  await page.getByRole('heading', { level: 1 }).waitFor();
  return page;
}

/** Fresh app data, Chinese interface, one Chinese resume. */
async function freshResume(): Promise<Page> {
  await device.shell(`pm clear ${PKG}`);
  const page = await launch();
  await page.getByRole('radio', { name: '中' }).click();
  await page.getByRole('button', { name: '新建中文简历' }).click();
  await expect(page.getByRole('list', { name: '简历模块' })).toBeVisible();
  return page;
}

const moduleButton = (page: Page, meta: ModuleMeta) =>
  page.getByRole('button', { name: new RegExp(`^${esc(zh(meta.labelKey))}`) });

async function openModule(page: Page, meta: ModuleMeta) {
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
