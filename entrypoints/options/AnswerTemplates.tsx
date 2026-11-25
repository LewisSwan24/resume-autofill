// Long-text answers in the settings: whether a draft may be rewritten by the local AI (off unless turned on), and the
// applicant's own templates per language. A template left as the default is not stored, so later defaults reach it.
import { useState } from 'react';
import { DEFAULT_TEMPLATES, TEMPLATE_KINDS, type TemplateKind, type TemplateLang } from '../../src/answers';
import { useT, useLanguage } from '../../src/i18n';
import type { Settings } from '../../src/schema';
import { Button, Field, Segmented, Switch, Textarea } from './ui/controls';

const KIND_LABEL = {
  coverLetter: 'options.answers.kind.coverLetter',
  whyUs: 'options.answers.kind.whyUs',
  strengths: 'options.answers.kind.strengths',
  careerPlan: 'options.answers.kind.careerPlan',
} as const satisfies Record<TemplateKind, string>;

export function AnswerTemplatesPanel({ settings, onChange }: { settings: Settings; onChange: (settings: Settings) => void }) {
  const t = useT();
  const ui = useLanguage();
  const [lang, setLang] = useState<TemplateLang>(ui === 'zh' ? 'zh' : 'en');
  const own = settings.answerTemplates?.[lang] ?? {};

  const save = (kind: TemplateKind, text: string | null) => {
    const next = { ...own };
    if (text === null || text.trim() === '' || text === DEFAULT_TEMPLATES[lang][kind]) delete next[kind];
    else next[kind] = text;
    onChange({ ...settings, answerTemplates: { ...settings.answerTemplates, [lang]: next } });
  };

  return (
    <div className="raf-form-stack">
      <Switch
        label={t('options.answers.rewrite')}
        help={t('options.answers.rewriteHint')}
        checked={settings.longTextAiRewrite === true}
        onChange={(longTextAiRewrite) => onChange({ ...settings, longTextAiRewrite })}
      />
      <Segmented<TemplateLang>
        label={t('options.answers.lang')}
        visibleLabel
        value={lang}
        options={[
          { value: 'zh', label: t('options.answers.langZh') },
          { value: 'en', label: t('options.answers.langEn') },
        ]}
        onChange={setLang}
      />
      <p className="raf-field__help">{t('options.answers.placeholders')}</p>
      {TEMPLATE_KINDS.map((kind) => {
        const label = t(KIND_LABEL[kind]);
        const custom = own[kind];
        return (
          <div key={`${lang}:${kind}`}>
            <Field label={label}>
              {(ctrl) => (
                <Textarea
                  {...ctrl}
                  rows={5}
                  spellCheck={false}
                  value={custom ?? DEFAULT_TEMPLATES[lang][kind]}
                  onChange={(e) => save(kind, e.target.value)}
                />
              )}
            </Field>
            {custom !== undefined ? (
              <Button aria-label={t('options.answers.restoreFor', { label })} onClick={() => save(kind, null)}>
                {t('options.answers.restore')}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
