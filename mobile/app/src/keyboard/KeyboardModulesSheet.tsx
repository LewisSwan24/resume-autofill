// 「输入法里显示的内容」: which kinds of resume entries go into the keyboard's copy. One
// checkbox per group in the keyboard strip's order; an unticked group is listed in appState.keyboard.hidden. The
// setting is per kind, not per resume, so groups with no content yet are listed too.
import { useMT } from '../i18n';
import type { AppState } from '../store/appStateStore';
import { Sheet, type ToastMessage } from '../ui';
import { KEYBOARD_GROUP_IDS, type KeyboardGroupId } from './keyboardData';
import './keyboard.css';

export interface KeyboardModulesSheetProps {
  open: boolean;
  onClose: () => void;
  appState: AppState;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

/** The hidden list in strip order, so the stored value does not depend on the order of taps. */
function withHidden(hidden: readonly KeyboardGroupId[], id: KeyboardGroupId, hide: boolean): KeyboardGroupId[] {
  const set = new Set(hidden);
  if (hide) set.add(id);
  else set.delete(id);
  return KEYBOARD_GROUP_IDS.filter((g) => set.has(g));
}

export function KeyboardModulesSheet({ open, onClose, appState, updateAppState, showToast }: KeyboardModulesSheetProps) {
  const t = useMT();
  const hidden = appState.keyboard.hidden;
  return (
    <Sheet open={open} title={t('m.kb.modulesTitle')} onClose={onClose}>
      <p className="m-kb-sheet__text">{t('m.kb.modulesText')}</p>
      <ul className="m-kb-groups">
        {KEYBOARD_GROUP_IDS.map((id) => (
          <li key={id}>
            <label className="m-check m-kb-groups__row">
              <input
                type="checkbox"
                checked={!hidden.includes(id)}
                onChange={(e) => {
                  const hide = !e.target.checked;
                  void updateAppState((s) => ({ ...s, keyboard: { ...s.keyboard, hidden: withHidden(s.keyboard.hidden, id, hide) } })).then((ok) => {
                    if (!ok) showToast({ text: t('m.saveStateFailed') });
                  });
                }}
              />
              <span>{t(`m.kb.group.${id}`)}</span>
            </label>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
