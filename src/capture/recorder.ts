// Records one tab of the applicant's own Chrome: what its network answers, its frames as static HTML, and its session
// storage. Chrome's APIs are handed in (chromeRecorderApi in the recorder page), so that a test can stand in for them.
//
// The order matters. Session storage is read first, while the tab holds the sign-in the applicant made, and before the
// reload, which may move it. Then the debugger listens, and only then does the tab reload, so the whole load is heard.
// Only the Network domain is turned on: a page cannot tell that it is being listened to that way.
import { HarRecorder } from './har.ts';
import { serializeInPage, type Serialized } from './serialize.ts';

export interface RecorderApi {
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  send(tabId: number, method: string, params?: object): Promise<unknown>;
  onEvent(listener: (source: { tabId?: number }, method: string, params?: object) => void): () => void;
  /** The debugger let go of the tab: its banner was closed, the tab closed, or DevTools took it. */
  onDetach(listener: (source: { tabId?: number }, reason: string) => void): () => void;
  reload(tabId: number): Promise<void>;
  runInTop<T>(tabId: number, func: () => T): Promise<T>;
  runInFrames<T>(tabId: number, func: () => T): Promise<{ frameId: number; result: T }[]>;
  frames(tabId: number): Promise<{ frameId: number; parentFrameId: number; url: string }[]>;
}

export interface Taken {
  /** Where the top frame ended up: the sample's address. */
  url: string;
  har: Awaited<ReturnType<HarRecorder['har']>>;
  frames: { url: string; data: Serialized }[];
  storage: { origin: string; sessionStorage: Record<string, string> } | null;
}

// Chrome keeps bodies in a buffer it empties as it pleases; asked for at once, they stay.
const BUFFERS = { maxTotalBufferSize: 200 * 1024 * 1024, maxResourceBufferSize: 50 * 1024 * 1024 };

// Runs in the page.
function readSessionStorage(): { origin: string; sessionStorage: Record<string, string> } {
  return { origin: location.origin, sessionStorage: { ...sessionStorage } };
}

export class TabRecorder {
  /** Requests heard so far, for the page to show. */
  requests = 0;
  onEnded: ((reason: string) => void) | null = null;
  onRequest: (() => void) | null = null;
  private readonly har: HarRecorder;
  private storage: Taken['storage'] = null;
  private ended: string | null = null;
  private unlisten: (() => void)[] = [];

  constructor(
    private readonly api: RecorderApi,
    private readonly tabId: number,
  ) {
    this.har = new HarRecorder((method, params) => api.send(tabId, method, params));
  }

  async start(): Promise<void> {
    this.storage = await this.api.runInTop(this.tabId, readSessionStorage).catch(() => null);
    await this.api.attach(this.tabId);
    this.unlisten.push(
      this.api.onEvent((source, method, params) => {
        if (source.tabId !== this.tabId) return;
        if (method === 'Network.requestWillBeSent') {
          this.requests++;
          this.onRequest?.();
        }
        this.har.event(method, params);
      }),
      this.api.onDetach((source, reason) => {
        if (source.tabId !== this.tabId) return;
        this.ended = reason;
        this.stopListening();
        this.onEnded?.(reason);
      }),
    );
    await this.api.send(this.tabId, 'Network.enable', BUFFERS);
    await this.api.reload(this.tabId);
  }

  /** Addresses whose answer Chrome had already let go of: they replay empty. */
  get unreadBodies(): string[] {
    return this.har.unreadBodies;
  }

  /** Takes the frames as they are now, then lets go of the tab. */
  async stop(): Promise<Taken> {
    if (this.ended) throw new Error(`the recording ended early: ${this.ended}`);
    const urls = new Map((await this.api.frames(this.tabId)).map((f) => [f.frameId, f.url]));
    const serialised = await this.api.runInFrames(this.tabId, serializeInPage);
    const har = await this.har.har();
    this.stopListening();
    await this.api.detach(this.tabId).catch(() => {});
    const frames = serialised
      .filter((f) => /^https?:/.test(urls.get(f.frameId) ?? ''))
      .sort((a, b) => (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : 0))
      .map((f) => ({ url: urls.get(f.frameId)!, data: f.result }));
    return { url: urls.get(0) ?? '', har, frames, storage: this.storage };
  }

  /** Lets go of the tab without taking anything. */
  async cancel(): Promise<void> {
    this.stopListening();
    if (!this.ended) await this.api.detach(this.tabId).catch(() => {});
  }

  private stopListening(): void {
    for (const off of this.unlisten.splice(0)) off();
  }
}
