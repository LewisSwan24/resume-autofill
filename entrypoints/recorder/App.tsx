// Recorder page: only in a build made with RAF_RECORDER=1. Records one tab of this Chrome into a sanitised sample
// bundle (src/capture/bundle.ts) for the replay tests. Sign in, pass any captcha and reach the page first; the
// recording starts with a reload of that tab, and nothing is filled, clicked or sent by this page.
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { buildCapture, termsFrom, type CaptureBundle } from '../../src/capture/bundle';
import { TabRecorder } from '../../src/capture/recorder';
import type { Finding } from '../../src/capture/sanitize';
import { loadProfile } from '../../src/storage';
import { Button, Checkbox, Field, Input, Notice, SelectInput, Textarea } from '../options/ui/controls';
import { chromeRecorderApi } from './chromeApi';
import '../../src/ui/fonts.css';
import '../../src/ui/theme.css';
import '../options/ui/ui.css';

interface Tab {
  id: number;
  title: string;
  url: string;
}

type State =
  | { step: 'idle' }
  | { step: 'recording'; requests: number }
  | { step: 'saving' }
  | { step: 'refused'; findings: Finding[] }
  | { step: 'saved'; file: string; entries: number; unread: number }
  | { step: 'failed'; message: string };

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function download(bundle: CaptureBundle): string {
  const file = `${bundle.meta.ats}-${bundle.meta.name}.raf-capture.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return file;
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [tabId, setTabId] = useState<number | null>(null);
  const [ats, setAts] = useState('');
  const [name, setName] = useState('');
  const [cn, setCn] = useState(false);
  const [extra, setExtra] = useState('');
  const [resumeTerms, setResumeTerms] = useState<string[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [state, setState] = useState<State>({ step: 'idle' });
  const recorder = useRef<TabRecorder | null>(null);

  useEffect(() => {
    void browser.tabs.query({}).then((all) =>
      setTabs(all.filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? '')).map((t) => ({ id: t.id!, title: t.title ?? '', url: t.url! }))),
    );
    // Every resume kept here is scrubbed from the recording, so a locked store means nothing can be recorded.
    loadProfile()
      .then((p) => setResumeTerms(termsFrom(p.resumes)))
      .catch(() => setLocked(true));
    return () => void recorder.current?.cancel();
  }, []);

  const ready = tabId !== null && SLUG.test(ats) && SLUG.test(name) && resumeTerms !== null;

  async function start() {
    if (tabId === null) return;
    const rec = new TabRecorder(chromeRecorderApi, tabId);
    rec.onRequest = () => setState({ step: 'recording', requests: rec.requests });
    rec.onEnded = (reason) => setState({ step: 'failed', message: `录制中断（${reason}）：调试横条被关掉或分页已关闭。没有保存任何内容。` });
    recorder.current = rec;
    try {
      await rec.start();
      setState({ step: 'recording', requests: rec.requests });
    } catch (e) {
      await rec.cancel();
      setState({ step: 'failed', message: String(e) });
    }
  }

  async function stop() {
    const rec = recorder.current;
    if (!rec) return;
    setState({ step: 'saving' });
    try {
      const taken = await rec.stop();
      const terms = [...(resumeTerms ?? []), ...extra.split(/[\n,，]/).map((t) => t.trim()).filter(Boolean)];
      const result = buildCapture({
        meta: { ats, name, url: taken.url, locale: navigator.language },
        capturedAt: new Date().toISOString(),
        har: taken.har,
        frames: taken.frames,
        storage: taken.storage,
        scrub: { terms, cn },
      });
      if (!result.ok) {
        setState({ step: 'refused', findings: result.findings });
        return;
      }
      setState({ step: 'saved', file: download(result.bundle), entries: result.bundle.meta.harEntries, unread: rec.unreadBodies.length });
    } catch (e) {
      setState({ step: 'failed', message: String(e) });
    } finally {
      recorder.current = null;
    }
  }

  async function cancel() {
    await recorder.current?.cancel();
    recorder.current = null;
    setState({ step: 'idle' });
  }

  const recording = state.step === 'recording' || state.step === 'saving';
  return (
    <main className="raf-page" style={{ maxWidth: 720, margin: '32px auto', display: 'grid', gap: 16 }}>
      <h1>录制样本</h1>
      <Notice>
        先在要录的分页里登录、过验证码、走到表单页，再回来点「开始」。开始时那个分页会重新载入，顶部会出现 Chrome 的「正在调试」横条；
        关掉横条就会中断录制。本页不填写、不点击、不提交任何东西。
      </Notice>
      {locked ? (
        <Notice tone="danger" title="简历库已锁定。">
          先到设置页解锁：录制要用所有已存简历里的姓名、地址等去遮盖录到的内容。
        </Notice>
      ) : null}
      <Field label="分页">
        {(control) => (
          <SelectInput {...control} value={tabId ?? ''} disabled={recording} onChange={(e) => setTabId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">选一个分页</option>
            {tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title || t.url}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
      <Field label="平台" help="小写字母、数字和连字符，例如 personio">
        {(control) => <Input {...control} value={ats} disabled={recording} onChange={(e) => setAts(e.target.value.trim())} />}
      </Field>
      <Field label="样本名" help="例如 support-engineer">
        {(control) => <Input {...control} value={name} disabled={recording} onChange={(e) => setName(e.target.value.trim())} />}
      </Field>
      <Checkbox label="中国站点：也遮盖手机号和身份证号" checked={cn} disabled={recording} onChange={setCn} />
      <Field label="另外要遮盖的词" help="逗号或换行分隔。已存简历里的值会自动遮盖。">
        {(control) => <Textarea {...control} value={extra} disabled={recording} rows={2} onChange={(e) => setExtra(e.target.value)} />}
      </Field>
      <div style={{ display: 'flex', gap: 8 }}>
        {recording ? (
          <>
            <Button variant="primary" disabled={state.step === 'saving'} onClick={() => void stop()}>
              停止并导出
            </Button>
            <Button disabled={state.step === 'saving'} onClick={() => void cancel()}>
              放弃
            </Button>
          </>
        ) : (
          <Button variant="primary" disabled={!ready} onClick={() => void start()}>
            开始
          </Button>
        )}
      </div>
      <Status state={state} />
    </main>
  );
}

function Status({ state }: { state: State }) {
  switch (state.step) {
    case 'idle':
      return null;
    case 'recording':
      return <p>录制中：已听到 {state.requests} 个请求。走到要录的页面后点「停止并导出」。</p>;
    case 'saving':
      return <p>正在读取页面并清洗……</p>;
    case 'saved':
      return (
        <Notice title="已导出。">
          {state.file}，{state.entries} 个请求。
          {state.unread > 0 ? ` 有 ${state.unread} 个回应 Chrome 已经丢掉，回放时是空的。` : ''}
        </Notice>
      );
    case 'refused':
      return (
        <Notice tone="danger" title={`清洗后仍有 ${state.findings.length} 处可能泄露，没有导出。`}>
          <ul>
            {state.findings.slice(0, 50).map((f, i) => (
              <li key={i}>
                {f.kind} · {f.where} · {f.sample}
              </li>
            ))}
          </ul>
        </Notice>
      );
    case 'failed':
      return (
        <Notice tone="danger" title="录制失败。">
          {state.message}
        </Notice>
      );
  }
}
