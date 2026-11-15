// 「在微信里填？用简历输入法」: a quiet note where the app knows its own browser cannot
// help (a WeChat-only link on Home, a page sending the person to WeChat), leading to the setup screen.
import { useId } from 'react';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { WechatOnlyReason } from './wechatHint';
import './keyboard.css';

const LINE: Record<WechatOnlyReason, string> = {
  'mini-program': 'm.kb.hint.miniProgram',
  'wechat-scheme': 'm.kb.hint.app',
  'wechat-login': 'm.kb.hint.login',
};

export function KeyboardHint({ reason, onSetup }: { reason: WechatOnlyReason; onSetup: () => void }) {
  const t = useMT();
  const titleId = useId();
  return (
    <div className="m-kb-hint" role="note" aria-labelledby={titleId}>
      <p className="m-kb-hint__head">
        <Icon name="keyboard" />
        <span id={titleId}>{t('m.kb.hint.title')}</span>
      </p>
      <p className="m-kb-hint__text">{t(LINE[reason])}</p>
      <button type="button" className="m-button m-button--text" onClick={onSetup}>
        {t('m.kb.hint.go')}
      </button>
    </div>
  );
}
