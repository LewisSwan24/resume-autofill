import { afterEach, describe, expect, it } from 'vitest';
import { ASYNC_CASCADER_LEVEL_MS, waitCascaderLevelReady } from '../../../src/drivers/asyncCascader';
import { mount } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('waitCascaderLevelReady', () => {
  it('waits until loading placeholders clear and real child options appear', async () => {
    const host = mount(`
      <div class="el-cascader__dropdown">
        <ul class="el-cascader-menu"><li class="el-cascader-node">Zhejiang</li></ul>
        <ul class="el-cascader-menu"><li class="el-cascader-node">加载中</li></ul>
      </div>
    `);
    const popup = host.querySelector<HTMLElement>('.el-cascader__dropdown')!;
    const col1 = popup.querySelectorAll<HTMLElement>('.el-cascader-menu')[1]!;

    setTimeout(() => {
      col1.innerHTML = '<li class="el-cascader-node">Hangzhou</li><li class="el-cascader-node">Ningbo</li>';
    }, 35);

    const ready = await waitCascaderLevelReady(
      popup,
      1,
      { columnSelector: '.el-cascader-menu', itemSelector: '.el-cascader-node' },
      { timeoutMs: 400 },
    );
    expect(ready).not.toBeNull();
    expect(ready!.options.map((o) => o.info.label)).toEqual(['Hangzhou', 'Ningbo']);
  });

  it('ignores columns still showing explicit loadingSelector spinners and returns null cleanly on timeout', async () => {
    const host = mount(`
      <div class="ant-cascader-dropdown">
        <ul class="ant-cascader-menu"><li class="ant-cascader-menu-item">Beijing</li></ul>
        <ul class="ant-cascader-menu"><span class="spinner"></span><li class="ant-cascader-menu-item">Temp</li></ul>
      </div>
    `);
    const popup = host.querySelector<HTMLElement>('.ant-cascader-dropdown')!;
    const res = await waitCascaderLevelReady(
      popup,
      1,
      { columnSelector: '.ant-cascader-menu', itemSelector: '.ant-cascader-menu-item', loadingSelector: '.spinner' },
      { timeoutMs: 60 },
    );
    expect(ASYNC_CASCADER_LEVEL_MS).toBe(1200);
    expect(res).toBeNull();
  });
});
