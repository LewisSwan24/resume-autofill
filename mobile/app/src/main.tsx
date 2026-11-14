// Entry of the mobile app's web UI. Wires the page to the phone: the encrypted ProfileVault store and the Android
// back key / pause events on a device; localStorage and page visibility when previewed in a desktop browser.
import './fonts.css';
import '../../../src/ui/theme.css';
import './styles.css';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { type Platform } from './App';
import { createLocalStorageStore, createVaultStore, type VaultPlugin } from './store/profileStore';

const native = Capacitor.isNativePlatform();

const store = native ? createVaultStore(registerPlugin<VaultPlugin>('ProfileVault')) : createLocalStorageStore(localStorage);

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
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} platform={platform} />
  </StrictMode>,
);
