// Options panel & lock-screen overlay for KEK/DEK Storage Vault at rest.
import { useEffect, useState } from 'react';
import { useT } from '../../src/i18n';
import {
  VAULT_MIN_PASSWORD_LENGTH,
  changeProfileVaultPassphrase,
  disableProfileVault,
  enableProfileVault,
  forgetProfileVault,
  getVaultStatus,
  lockProfileVault,
  unlockProfileVault,
  updateVaultIdleTimeout,
  type VaultStatus,
} from '../../src/storage';
import { Button, Field, Input, Notice, SelectInput } from './ui/controls';
import { Dialog } from './ui/Dialog';
import { useToast } from './ui/Toast';

interface VaultPanelProps {
  mode?: 'settings' | 'unlock';
  onUnlocked?: () => void;
  /** After "Lock now": the editor must know so it can hold edits and offer to unlock. */
  onLocked?: () => void;
  /** Unlock mode only: offers "forget the vault and restore from a backup"; called once storage is cleared. */
  onForgotten?: () => void;
  /** Unlock mode only: there are edits waiting for the vault to be unlocked. */
  pendingChanges?: boolean;
}

function PassField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      {(ctrl) => <Input {...ctrl} type="password" value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function VaultPanel({ mode = 'settings', onUnlocked, onLocked, onForgotten, pendingChanges }: VaultPanelProps) {
  const t = useT();
  const toast = useToast();
  const [status, setStatus] = useState<VaultStatus>({
    enabled: false,
    unlocked: true,
    idleTimeoutMs: 15 * 60 * 1000,
    lastActiveAt: null,
  });
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState('');
  const [nextPass, setNextPass] = useState('');
  const [nextConfirm, setNextConfirm] = useState('');
  const [idleMinutes, setIdleMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forgetAsked, setForgetAsked] = useState(false);

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
    // A typo here would lock the data away for good, so the passphrase is entered twice.
    if (passphrase !== confirm) {
      setErr(t('options.vault.mismatch'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await enableProfileVault(passphrase, { idleTimeoutMs: idleMinutes * 60_000 });
      setPassphrase('');
      setConfirm('');
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
    onLocked?.();
  };

  const handleChange = async () => {
    if (nextPass.length < VAULT_MIN_PASSWORD_LENGTH) {
      setErr(t('options.vault.wrongPass'));
      return;
    }
    if (nextPass !== nextConfirm) {
      setErr(t('options.vault.mismatch'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await changeProfileVaultPassphrase(current, nextPass);
      setCurrent('');
      setNextPass('');
      setNextConfirm('');
      refresh();
      toast.push({ text: t('options.vault.changed') });
    } catch {
      setErr(t('options.vault.wrongPass'));
    } finally {
      setBusy(false);
    }
  };

  const handleForget = async () => {
    setForgetAsked(false);
    setBusy(true);
    try {
      await forgetProfileVault();
      onForgotten?.();
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'unlock') {
    return (
      <section className="raf-card raf-form-stack" aria-label={t('options.vault.unlockTitle')}>
        <h2 className="raf-heading">{t('options.vault.unlockTitle')}</h2>
        <p className="raf-caption">{pendingChanges ? t('options.vault.pendingHint') : t('options.vault.unlockHint')}</p>
        {err ? <Notice tone="danger">{err}</Notice> : null}
        <PassField label={t('options.vault.passLabel')} value={passphrase} onChange={setPassphrase} />
        <div className="raf-row-actions">
          <Button variant="primary" disabled={busy} onClick={() => void handleUnlock()}>
            {t('options.vault.unlock')}
          </Button>
          {onForgotten ? (
            <Button disabled={busy} onClick={() => setForgetAsked(true)}>
              {t('options.vault.forget')}
            </Button>
          ) : null}
        </div>
        {forgetAsked ? (
          <Dialog
            title={t('options.vault.forgetTitle')}
            text={t('options.vault.forgetText')}
            cancelLabel={t('options.notNow')}
            confirmLabel={t('options.vault.forgetConfirm')}
            danger
            onCancel={() => setForgetAsked(false)}
            onConfirm={() => void handleForget()}
          />
        ) : null}
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
        <PassField label={t('options.vault.passLabel')} value={passphrase} onChange={setPassphrase} />
        {!status.enabled ? (
          <PassField label={t('options.vault.confirmLabel')} value={confirm} onChange={setConfirm} />
        ) : null}
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
            <Button variant="danger" disabled={busy} onClick={() => void handleDisable()}>
              {t('options.vault.disable')}
            </Button>
          </>
        )}
      </div>

      {status.enabled ? (
        <>
          <h4 className="raf-subheading">{t('options.vault.changeTitle')}</h4>
          <div className="raf-row-actions">
            <PassField label={t('options.vault.currentLabel')} value={current} onChange={setCurrent} />
            <PassField label={t('options.vault.newLabel')} value={nextPass} onChange={setNextPass} />
            <PassField label={t('options.vault.newConfirmLabel')} value={nextConfirm} onChange={setNextConfirm} />
          </div>
          <div className="raf-row-actions">
            <Button disabled={busy || !current || !nextPass} onClick={() => void handleChange()}>
              {t('options.vault.change')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
