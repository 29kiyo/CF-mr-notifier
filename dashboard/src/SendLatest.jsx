import { useState } from 'react';
import { api, errorMessage } from './lib.js';
import { Modal, Switch, toast } from './ui.jsx';

// 「最新の情報を送信」: 保存済みの設定で、いまの最新バージョンを通常の通知として送る
export default function SendLatestModal({ gid, p, onClose, onDone }) {
  const [mentions, setMentions] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const r = await api(`/api/guilds/${gid}/projects/${p.id}/send-latest`, { method: 'POST', body: { mentions } });
      toast(`最新の情報を${r.sent}件送りました`, 'ok');
      onDone?.();
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <Modal title={`「${p.name}」の最新の情報を送信`} onClose={busy ? () => {} : onClose}>
      <p className="muted">
        保存済みの設定で、いまの最新バージョン(GitHubは最新のリリースとコミット)を通知チャンネルに送ります。「テスト送信」と違い、本物の通知と同じ見た目で送られます。
      </p>
      <div className="switchrow compact" style={{ marginTop: '1rem' }}>
        <span>
          メンションも送る
          <span className="hint" style={{ display: 'block' }}>
            オフなら、設定したメンションは付けずに送ります。
          </span>
        </span>
        <Switch checked={mentions} onChange={setMentions} label="メンションも送る" />
      </div>
      <div className="right row">
        <button className="btn" onClick={onClose} disabled={busy}>
          キャンセル
        </button>
        <button className="btn primary" onClick={send} disabled={busy}>
          {busy ? '送信中…' : '📤 送信する'}
        </button>
      </div>
    </Modal>
  );
}
