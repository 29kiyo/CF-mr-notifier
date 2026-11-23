import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { allowedOrigins, publicUrl } from './config.js';
import { botInGuild } from './bot.js';

const API = 'https://discord.com/api/v10';
const SECRET = () => process.env.SESSION_SECRET;

export const authRouter = express.Router();

function okReturn(u) {
  try {
    const x = new URL(String(u));
    return allowedOrigins.includes(x.origin) ? x : null;
  } catch {
    return null;
  }
}

// ダッシュボードの「Discordでログイン」ボタンはここに飛ばす
authRouter.get('/login', (req, res) => {
  const ret = okReturn(req.query.return) || (allowedOrigins[0] ? new URL(allowedOrigins[0]) : null);
  if (!ret) return res.status(500).send('DASHBOARD_ORIGINS が未設定です');
  const state = jwt.sign({ ret: ret.toString(), n: crypto.randomUUID() }, SECRET(), { expiresIn: '10m' });
  const p = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${publicUrl()}/auth/callback`,
    scope: 'identify guilds',
    state,
    prompt: 'none',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${p}`);
});

authRouter.get('/callback', async (req, res) => {
  let ret;
  try {
    const st = jwt.verify(String(req.query.state || ''), SECRET());
    ret = new URL(st.ret);
  } catch {
    return res.status(400).send('ログインの有効期限が切れました。もう一度ログインしてください。');
  }
  const back = (hash) => {
    ret.hash = hash;
    return res.redirect(ret.toString());
  };
  if (req.query.error || !req.query.code) return back('error=access_denied');

  try {
    const redirect_uri = `${publicUrl()}/auth/callback`;
    const tr = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri,
      }),
    });
    if (!tr.ok) throw new Error(`token ${tr.status}`);
    const { access_token } = await tr.json();
    const h = { Authorization: `Bearer ${access_token}` };
    const [user, guilds] = await Promise.all([
      fetch(`${API}/users/@me`, { headers: h }).then((r) => r.json()),
      fetch(`${API}/users/@me/guilds`, { headers: h }).then((r) => r.json()),
    ]);
    if (!user?.id || !Array.isArray(guilds)) throw new Error('profile');

    // 「サーバー管理」or「管理者」権限を持つサーバーだけ操作できる
    const manageable = guilds
      .filter((g) => g.owner || (BigInt(g.permissions) & 0x28n) !== 0n)
      .slice(0, 100)
      .map((g) => ({ id: g.id, name: g.name, icon: g.icon }));

    const token = jwt.sign(
      {
        sub: user.id,
        name: user.global_name || user.username,
        avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null,
        guilds: manageable,
      },
      SECRET(),
      { expiresIn: '8h' },
    );
    return back(`token=${token}`);
  } catch (e) {
    console.error('[auth] failed:', e.message);
    return back('error=login_failed');
  }
});

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'ログインが必要です' });
  try {
    req.user = jwt.verify(t, SECRET());
    next();
  } catch {
    res.status(401).json({ error: 'ログインの有効期限が切れました', code: 'session_expired' });
  }
}

export function requireGuild(req, res, next) {
  const gid = req.params.gid;
  if (!req.user.guilds.some((g) => g.id === gid)) return res.status(403).json({ error: 'このサーバーを管理する権限がありません' });
  if (!botInGuild(gid)) return res.status(404).json({ error: 'ボットがこのサーバーに参加していません', code: 'bot_not_in_guild' });
  next();
}
