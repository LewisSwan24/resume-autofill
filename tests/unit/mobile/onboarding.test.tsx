// First-run onboarding: three promises, then three ways to get a resume ready (import, start blank, PDF / Word).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Onboarding, type OnboardingProps } from '../../../mobile/app/src/onboarding/Onboarding';
import { setLanguage } from '../../../src/i18n';

function renderStep(step: 1 | 2, over: Partial<OnboardingProps> = {}) {
  const props: OnboardingProps = {
    step,
    onStep: vi.fn(),
    language: 'zh',
    onLanguage: vi.fn(),
    onSkip: vi.fn(),
    onStartBlank: vi.fn(),
    onImport: vi.fn(),
    onImportResume: vi.fn(),
    onTryDemo: vi.fn(),
    showToast: vi.fn(),
    ...over,
  };
  render(<Onboarding {...props} />);
  return props;
}

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

describe('Onboarding', () => {
  it('welcome lists the three promises, with Continue and Skip', () => {
    renderStep(1);
    expect(screen.getByRole('heading', { level: 1, name: '你好，先说三件事' })).toBeTruthy();
    expect(screen.getByText('第 1 步，共 2 步')).toBeTruthy();
    const list = screen.getByRole('list', { name: '三个承诺' });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(items).toEqual([
      '资料只存在这台手机里，加密保存，不上传。',
      'App 不会替你提交任何表单。',
      '填完以后，提交前自己检查一遍。',
    ]);
    expect(screen.getByRole('button', { name: '继续' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '跳过' })).toBeTruthy();
  });

  it('Continue goes to step 2; Back returns to step 1', () => {
    const one = renderStep(1);
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(one.onStep).toHaveBeenCalledWith(2);
    cleanup();
    const two = renderStep(2);
    expect(screen.getByRole('heading', { level: 1, name: '准备好你的简历' })).toBeTruthy();
    expect(screen.getByText('第 2 步，共 2 步')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(two.onStep).toHaveBeenCalledWith(1);
  });

  it('Skip calls onSkip on either step', () => {
    const one = renderStep(1);
    fireEvent.click(screen.getByRole('button', { name: '跳过' }));
    expect(one.onSkip).toHaveBeenCalledTimes(1);
    cleanup();
    const two = renderStep(2);
    fireEvent.click(screen.getByRole('button', { name: '跳过' }));
    expect(two.onSkip).toHaveBeenCalledTimes(1);
  });

  it('Import from computer calls onImport', () => {
    const p = renderStep(2);
    fireEvent.click(screen.getByRole('button', { name: /^从电脑导入/ }));
    expect(p.onImport).toHaveBeenCalledTimes(1);
  });

  it('Start from scratch shows new Chinese / new English, which call onStartBlank', () => {
    const p = renderStep(2);
    const blank = screen.getByRole('button', { name: /^从空白开始/ });
    expect(blank.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: '新建中文简历' })).toBeNull();
    fireEvent.click(blank);
    expect(blank.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '新建中文简历' }));
    expect(p.onStartBlank).toHaveBeenLastCalledWith('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: '新建英文简历' }));
    expect(p.onStartBlank).toHaveBeenLastCalledWith('en-AU');
  });

  it('the PDF / Word option is live: an ordinary button that starts the resume import', () => {
    const p = renderStep(2);
    const pdf = screen.getByRole('button', { name: /^导入 PDF \/ Word 简历/ });
    expect(pdf.hasAttribute('aria-disabled')).toBe(false);
    expect(within(pdf).queryByText('即将推出')).toBeNull();
    fireEvent.click(pdf);
    expect(p.onImportResume).toHaveBeenCalledTimes(1);
    expect(p.showToast).not.toHaveBeenCalled();
    expect(p.onImport).not.toHaveBeenCalled();
  });

  it('step 2 offers 「先试试示例表单」 last, which calls onTryDemo and nothing else', () => {
    const p = renderStep(2);
    const options = screen.getAllByRole('button').filter((b) => b.classList.contains('m-onb__option'));
    expect(options.map((b) => b.querySelector('.m-row__name')?.textContent)).toEqual([
      '从电脑导入', '从空白开始', '导入 PDF / Word 简历', '先试试示例表单',
    ]);
    const demo = screen.getByRole('button', { name: /^先试试示例表单/ });
    expect(demo.querySelector('svg')?.getAttribute('data-icon')).toBe('play-circle');
    expect(within(demo).getByText('用虚构的张三演示一次填写，不碰真实网站。')).toBeTruthy();
    fireEvent.click(demo);
    expect(p.onTryDemo).toHaveBeenCalledTimes(1);
    expect(p.onSkip).not.toHaveBeenCalled();
    expect(p.onImport).not.toHaveBeenCalled();
  });

  it('without a fill browser there is no demo option', () => {
    renderStep(2, { onTryDemo: undefined });
    expect(screen.queryByRole('button', { name: /^先试试示例表单/ })).toBeNull();
  });

  it('the language switch on the welcome step calls onLanguage', () => {
    const p = renderStep(1);
    const group = screen.getByRole('radiogroup', { name: '界面语言' });
    expect(within(group).getByRole('radio', { name: '中' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: 'EN' }));
    expect(p.onLanguage).toHaveBeenCalledWith('en');
  });

  it('reads in English when the language is English', () => {
    setLanguage('en');
    renderStep(1, { language: 'en' });
    expect(screen.getByRole('heading', { level: 1, name: 'Hi! Three things first' })).toBeTruthy();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });
});
