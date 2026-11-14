// Entry of the mobile app's web UI. Wires the app to the phone: the encrypted ProfileVault stores, the wipe, the
// "create document" saver, files handed over by other apps (open with / share), app info and the Android back key /
// pause events on a device; localStorage, IndexedDB, downloads and page visibility when previewed in a desktop browser.
import './fonts.css';
import '../../../src/ui/theme.css';
import './styles.css';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { type Platform } from './App';
import { createNativeIncomingSource, type IncomingFilePlugin } from './resumeImport/incoming';
import { createLocalStorageAppStateStore, createVaultAppStateStore, type AppStateVaultPlugin } from './store/appStateStore';
import { createIndexedDbFileStore, createVaultFileStore, toBase64, type FileVaultPlugin } from './store/fileStore';
import { createLocalStorageStore, createVaultStore, type VaultPlugin } from './store/profileStore';
import { createStoreWiper, createVaultWiper, type WipeVaultPlugin } from './store/wipe';

/** Set by vite.config.ts from mobile/package.json. */
declare const __APP_VERSION__: string;

/** The native DocumentSaver plugin (DocumentSaverPlugin.java): Android's "create document" picker. */
interface DocumentSaverPlugin {
  save(options: { name: string; mimeType: string; data: string }): Promise<{ saved: boolean }>;
}

const native = Capacitor.isNativePlatform();

const vault = native ? registerPlugin<VaultPlugin & FileVaultPlugin & AppStateVaultPlugin & WipeVaultPlugin>('ProfileVault') : null;
const store = vault ? createVaultStore(vault) : createLocalStorageStore(localStorage);
const files = vault ? createVaultFileStore(vault) : createIndexedDbFileStore();
const appState = vault ? createVaultAppStateStore(vault) : createLocalStorageAppStateStore(localStorage);
const wiper = vault ? createVaultWiper(vault) : createStoreWiper({ profile: store, files, appState });
const documentSaver = native ? registerPlugin<DocumentSaverPlugin>('DocumentSaver') : null;
/** The native IncomingFile plugin (IncomingFilePlugin.java). The browser preview has no incoming files. */
const incomingPlugin = native ? registerPlugin<IncomingFilePlugin>('IncomingFile') : null;

function onHidden(handler: () => void): () => void {
  const listener = () => {
    if (document.visibilityState === 'hidden') handler();
  };
  document.addEventListener('visibilitychange', listener);
  window.addEventListener('pagehide', handler);
  return () => {
    document.removeEventListener('visibilitychange', listener);
    window.removeEventListener('pagehide', handler);
  };
}

/** Browser preview: hand the file to the browser as a download. */
function download(file: { name: string; mimeType: string; bytes: Uint8Array }): 'saved' {
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}

const platform: Platform = {
  onBack(handler) {
    if (!native) return () => undefined;
    // With a listener registered Capacitor no longer leaves the app by itself, so do it when the page passes.
    const listening = CapacitorApp.addListener('backButton', () => {
      if (!handler()) void CapacitorApp.exitApp();
    });
    return () => void listening.then((l) => l.remove());
  },
  onPause(handler) {
    const offHidden = onHidden(handler);
    if (!native) return offHidden;
    const listening = CapacitorApp.addListener('pause', handler);
    return () => {
      offHidden();
      void listening.then((l) => l.remove());
    };
  },
  async appInfo() {
    if (!native) return { name: '网申简历填写', version: __APP_VERSION__, build: 'web' };
    const info = await CapacitorApp.getInfo();
    return { name: info.name, version: info.version, build: info.build };
  },
  async saveDocument(file) {
    if (!documentSaver) return download(file);
    const result = await documentSaver.save({ name: file.name, mimeType: file.mimeType, data: toBase64(file.bytes) });
    return result.saved ? 'saved' : 'cancelled';
  },
  incoming: incomingPlugin ? createNativeIncomingSource(incomingPlugin) : undefined,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} files={files} appState={appState} wiper={wiper} platform={platform} />
  </StrictMode>,
);
