// Options tab: Offline JD Match Analyzer + Non-Destructive Variant Studio + Declarative SiteRecipe Manager.
import { useRef, useState } from 'react';
import { addResume } from '../../src/editor';
import { useT } from '../../src/i18n';
import {
  BUILTIN_SITE_RECIPES,
  exportRecipesJson,
  parseRecipesJson,
} from '../../src/recipes';
import { ResumeSchema, type Profile, type Resume } from '../../src/schema';
import {
  analyzeResumeAgainstJd,
  buildVariantMetaFromJd,
  generateTailoredSummaryDraft,
  type JdAnalysisResult,
  type TailoredRewriteDraft,
} from '../../src/tailor';
import { Badge, Button, EmptyState, Field, Notice, Textarea } from './ui/controls';
import { useToast } from './ui/Toast';

interface TailorPanelProps {
  profile: Profile;
  resume: Resume | null;
  onCommit: (next: Profile, options?: { immediate?: boolean }) => Promise<void>;
  onSelectResume: (id: string) => void;
}

export function TailorPanel({ profile, resume, onCommit, onSelectResume }: TailorPanelProps) {
  const t = useT();
  const toast = useToast();
  const [jdText, setJdText] = useState('');
  const [analysis, setAnalysis] = useState<JdAnalysisResult | null>(null);
  const [rewrite, setRewrite] = useState<TailoredRewriteDraft | null>(null);
  const [draftSummary, setDraftSummary] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const customRecipes = profile.recipes ?? [];

  const handleAnalyze = () => {
    if (!resume || !jdText.trim()) return;
    setRewrite(null);
    setAnalysis(analyzeResumeAgainstJd(resume, jdText));
  };

  const handleRewrite = async () => {
    if (!resume || !analysis) return;
    setRewriting(true);
    try {
      const res = await generateTailoredSummaryDraft({
        resume,
        targetRole: analysis.targetRole,
        matchedKeywords: analysis.matchedKeywords,
        settings: profile.settings,
      });
      if (res) {
        setRewrite(res);
        setDraftSummary(res.rewrittenText);
      }
    } finally {
      setRewriting(false);
    }
  };

  const handleSaveVariant = async () => {
    if (!resume || !analysis) return;
    const baseId = resume.variantOf ?? resume.id;
    const overlay = buildVariantMetaFromJd(resume, analysis);
    if (draftSummary.trim()) overlay.customSummary = draftSummary.trim();
    const roleLabel = analysis.targetRole || 'JD';
    const title = `${resume.title} · ${roleLabel}`.slice(0, 80);
    const variant = ResumeSchema.parse({
      id: crypto.randomUUID(),
      title,
      locale: resume.locale,
      variantOf: baseId,
      variantMeta: overlay,
    });
    const next = addResume(profile, variant, { activate: true });
    await onCommit(next, { immediate: true });
    onSelectResume(variant.id);
    toast.push({ text: t('options.tailor.variantSaved', { title }) });
  };

  const handleExportRecipes = () => {
    const json = exportRecipesJson([...customRecipes, ...BUILTIN_SITE_RECIPES]);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `resume-autofill-recipes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportRecipes = async (file: File | undefined) => {
    if (!file) return;
    setRecipeError(null);
    try {
      const parsed = parseRecipesJson(await file.text());
      const byId = new Map(customRecipes.map((r) => [r.id, r]));
      for (const rec of parsed) byId.set(rec.id, rec);
      const next = { ...profile, recipes: Array.from(byId.values()) };
      await onCommit(next, { immediate: true });
      toast.push({ text: t('options.recipes.importDone', { n: parsed.length }) });
    } catch (e) {
      setRecipeError(t('options.recipes.importError', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div className="raf-form-stack">
      <section className="raf-card raf-form-stack" aria-label={t('options.tailor.title')}>
        <h2 className="raf-heading">{t('options.tailor.title')}</h2>
        <p className="raf-caption">{t('options.tailor.lead')}</p>

        {!resume ? (
          <EmptyState icon="file-earmark-text">{t('options.empty')}</EmptyState>
        ) : (
          <>
            <Field label={t('options.tailor.jdLabel')}>
              {(ctrl) => (
                <Textarea
                  {...ctrl}
                  rows={5}
                  value={jdText}
                  placeholder={t('options.tailor.jdPlaceholder')}
                  onChange={(e) => setJdText(e.target.value)}
                />
              )}
            </Field>
            <div className="raf-row-actions">
              <Button variant="primary" disabled={!jdText.trim()} onClick={handleAnalyze}>
                {t('options.tailor.analyze')}
              </Button>
              {analysis ? (
                <>
                  <Button disabled={rewriting} onClick={() => void handleRewrite()}>
                    {t('options.tailor.rewriteSummary')}
                  </Button>
                  <Button variant="primary" onClick={() => void handleSaveVariant()}>
                    {t('options.tailor.saveVariant')}
                  </Button>
                </>
              ) : null}
            </div>

            {analysis ? (
              <div className="raf-form-stack">
                <Notice tone="info">
                  {t('options.tailor.score', {
                    score: analysis.matchScore,
                    hit: analysis.matchedKeywords.length,
                    total: analysis.totalKeywords,
                  })}
                </Notice>
                <div>
                  <strong>{t('options.tailor.matched')}: </strong>
                  {analysis.matchedKeywords.map((kw) => (
                    <Badge key={kw}>{kw}</Badge>
                  ))}
                </div>
                {analysis.missingKeywords.length > 0 ? (
                  <p className="raf-caption">
                    <strong>{t('options.tailor.missing')}: </strong>
                    {analysis.missingKeywords.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}

            {rewrite ? (
              <div className="raf-form-stack">
                {!rewrite.factCheck.ok ? (
                  <Notice tone="danger">
                    {t('options.tailor.factWarn', { metrics: rewrite.factCheck.inventedMetrics.join(', ') })}
                  </Notice>
                ) : null}
                <Field label={t('options.field.selfIntroduction')}>
                  {(ctrl) => (
                    <Textarea
                      {...ctrl}
                      rows={4}
                      value={draftSummary}
                      onChange={(e) => setDraftSummary(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="raf-card raf-form-stack" aria-label={t('options.recipes.title')}>
        <h2 className="raf-heading">{t('options.recipes.title')}</h2>
        <p className="raf-caption">{t('options.recipes.lead')}</p>
        <p className="raf-caption">
          {t('options.recipes.builtinCount', {
            n: BUILTIN_SITE_RECIPES.length,
            custom: customRecipes.length,
          })}
        </p>
        {recipeError ? <Notice tone="danger">{recipeError}</Notice> : null}
        <div className="raf-row-actions">
          <Button onClick={handleExportRecipes}>{t('options.recipes.export')}</Button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void handleImportRecipes(f);
            }}
          />
          <Button onClick={() => importRef.current?.click()}>{t('options.recipes.import')}</Button>
        </div>
        {customRecipes.length > 0 ? (
          <ul>
            {customRecipes.map((r) => (
              <li key={r.id} className="raf-caption">
                {r.name} ({r.hostPattern}) · {r.rules.length}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
