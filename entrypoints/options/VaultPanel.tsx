// Options panel & lock-screen overlay for KEK/DEK Storage Vault at rest.
import { useEffect, useState } from 'react';
import { useT } from '../../src/i18n';
import {
  VAULT_MIN_PASSWORD_LENGTH,
  changeProfileVaultPassphrase,
  disableProfileVault,
  enableProfileVault,
  getVaultStatus,
  lockProfileVault,
  unlockProfileVault,
  updateVaultIdleTimeout,
  type VaultStatus,
} from '../../src/storage';
import { Button, Field, Input, Notice, SelectInput } from './ui/controls';
import { useToast } from './ui/Toast';

interface VaultPanelProps {
  mode?: 'settings' | 'unlock';
  onUnlocked?: () => void;
}

export function VaultPanel({ mode = 'settings', onUnlocked }: VaultPanelProps) {
  const t = useT();
  const toast = useToast();
  const [status, setStatus] = useState<VaultStatus>({
    enabled: false,
    unlocked: true,
    idleTimeoutMs: 15 * 60 * 1000,
    lastActiveAt: null,
  });
  const [passphrase, setPassphrase] = useState('');
  const [idleMinutes, setIdleMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    void getVaultStatus().then((s) => {
      setStatus(s);
      setIdleMinutes(Math.max(1, Math.round(s.idleTimeoutMs / 60_000)));
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleEnable = async () => {
    if (passphrase.length < VAULT_MIN_PASSWORD_LENGTH) {
      setErr(t('options.vault.wrongPass'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await enableProfileVault(passphrase, { idleTimeoutMs: idleMinutes * 60_000 });
      setPassphrase('');
      refresh();
      toast.push({ text: t('options.vault.stateEnabled', { state: t('options.vault.stateUnlocked') }) });
    } catch {
      setErr(t('options.vault.wrongPass'));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    if (passphrase.length < VAULT_MIN_PASSWORD_LENGTH) {
      setErr(t('options.vault.wrongPass'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await unlockProfileVault(passphrase);
      setPassphrase('');
      refresh();
      onUnlocked?.();
    } catch {
      setErr(t('options.vault.wrongPass'));
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (passphrase.length < VAULT_MIN_PASSWORD_LENGTH) {
      setErr(t('options.vault.wrongPass'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await disableProfileVault(passphrase);
      setPassphrase('');
      refresh();
    } catch {
      setErr(t('options.vault.wrongPass'));
    } finally {
      setBusy(false);
    }
  };

  const handleLockNow = async () => {
    await lockProfileVault();
    refresh();
    onUnlocked?.();
  };

  if (mode === 'unlock') {
    return (
      <section className="raf-card raf-form-stack" aria-label={t('options.vault.unlockTitle')}>
        <h2 className="raf-heading">{t('options.vault.unlockTitle')}</h2>
        <p className="raf-caption">{t('options.vault.unlockHint')}</p>
        {err ? <Notice tone="danger">{err}</Notice> : null}
        <Field label={t('options.vault.passLabel')}>
          {(ctrl) => (
            <Input
              {...ctrl}
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          )}
        </Field>
        <div className="raf-row-actions">
          <Button variant="primary" disabled={busy} onClick={() => void handleUnlock()}>
            {t('options.vault.unlock')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="raf-form-stack">
      <h3 className="raf-subheading">{t('options.vault.title')}</h3>
      <p className="raf-caption">{t('options.vault.lead')}</p>
      {status.enabled ? (
        <Notice tone="info">
          {t('options.vault.stateEnabled', {
            state: status.unlocked ? t('options.vault.stateUnlocked') : t('options.vault.stateLocked'),
          })}
        </Notice>
      ) : null}
      {err ? <Notice tone="danger">{err}</Notice> : null}

      <div className="raf-row-actions">
        <Field label={t('options.vault.passLabel')}>
          {(ctrl) => (
            <Input
              {...ctrl}
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('options.vault.idleMinutes')}>
          {(ctrl) => (
            <SelectInput
              {...ctrl}
              value={String(idleMinutes)}
              onChange={(e) => {
                const mins = Number(e.target.value);
                setIdleMinutes(mins);
                if (status.enabled) void updateVaultIdleTimeout(mins * 60_000);
              }}
            >
              <option value="5">5</option>
              <option value="15">15</option>
              <option value="30">30</option>
              <option value="60">60</option>
            </SelectInput>
          )}
        </Field>
      </div>

      <div className="raf-row-actions">
        {!status.enabled ? (
          <Button variant="primary" disabled={busy} onClick={() => void handleEnable()}>
            {t('options.vault.enable')}
          </Button>
        ) : (
          <>
            {!status.unlocked ? (
              <Button variant="primary" disabled={busy} onClick={() => void handleUnlock()}>
                {t('options.vault.unlock')}
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void handleLockNow()}>
                {t('options.vault.lockNow')}
              </Button>
            )}
            <Button
              disabled={busy || passphrase.length < VAULT_MIN_PASSWORD_LENGTH}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await changeProfileVaultPassphrase(passphrase, passphrase);
                  setPassphrase('');
                } catch {
                  setErr(t('options.vault.wrongPass'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              OK
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void handleDisable()}>
              {t('options.vault.disable')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
