// The options page's long-text section: the AI rewrite switch (off by default) and the applicant's own templates.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnswerTemplatesPanel } from '../../../entrypoints/options/AnswerTemplates';
import { DEFAULT_TEMPLATES } from '../../../src/answers';
import { setLanguage } from '../../../src/i18n';
import { SettingsSchema, type Settings } from '../../../src/schema';

beforeEach(() => setLanguage('en'));
afterEach(() => cleanup());

const fresh = (): Settings => SettingsSchema.parse({});

describe('AnswerTemplatesPanel', () => {
  it('starts with the rewrite switch off and the default templates shown', () => {
    render(<AnswerTemplatesPanel settings={fresh()} onChange={vi.fn()} />);
    expect((screen.getByRole('switch', { name: /Rewrite drafts with the local AI/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Cover letter') as HTMLTextAreaElement).value).toBe(DEFAULT_TEMPLATES.en.coverLetter);
  });

  it('turns the rewrite on', () => {
    const onChange = vi.fn();
    render(<AnswerTemplatesPanel settings={fresh()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: /Rewrite drafts with the local AI/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ longTextAiRewrite: true }));
  });

  it('keeps an edited template under its language, and puts the default back', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AnswerTemplatesPanel settings={fresh()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Chinese resumes' }));
    fireEvent.change(screen.getByLabelText('Why us'), { target: { value: '我想加入{公司}。' } });
    const saved = onChange.mock.calls.at(-1)![0] as Settings;
    expect(saved.answerTemplates).toEqual({ zh: { whyUs: '我想加入{公司}。' } });

    rerender(<AnswerTemplatesPanel settings={saved} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore default: Why us' }));
    expect((onChange.mock.calls.at(-1)![0] as Settings).answerTemplates).toEqual({ zh: {} });
  });
});
