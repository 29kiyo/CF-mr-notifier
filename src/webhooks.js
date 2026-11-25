import express from 'express';
import crypto from 'node:crypto';
import * as db from './db.js';
import { sendToChannel, explainSendError } from './bot.js';
import { buildGithubMessage } from './github-events.js';

export const webhookRouter = express.Router();

const recentDeliveries = new Set();

// GitHub の Settings → Webhooks に設定するURL: /webhooks/github/<通知元ID>
webhookRouter.post('/github/:sid', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const sid = req.params.sid;
  if (!/^[0-9a-f-]{36}$/i.test(sid)) return res.status(404).end();

  let src;
  try {
    src = await db.getSourceWithProject(sid);
  } catch (e) {
    console.error('[webhook] db error:', e.message);
    return res.status(500).end();
  }
  if (!src || src.platform !== 'github' || !src.project) return res.status(404).end();

  // 署名(Secret)の確認。合わないリクエストは受け付けない。
  const secret = src.config?.webhook_secret;
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const sig = String(req.get('x-hub-signature-256') || '');
  if (!secret) return res.status(401).json({ error: 'secret not set' });
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'invalid signature' });

  const event = String(req.get('x-github-event') || '');
  if (src.config?.mode === 'release' && String(req.get('x-github-event')) !== 'ping') return res.json({ ok: true, ignored: 'release mode' });
  if (event === 'ping') return res.json({ ok: true, pong: true });

  const delivery = req.get('x-github-delivery');
  if (delivery) {
    if (recentDeliveries.has(delivery)) return res.json({ ok: true, duplicate: true });
    recentDeliveries.add(delivery);
    if (recentDeliveries.size > 500) recentDeliveries.delete(recentDeliveries.values().next().value);
  }

  const project = src.project;
  if (!project.enabled) return res.json({ ok: true, ignored: 'disabled' });

  let payload;
  try {
    let text = raw.toString('utf8');
    if ((req.get('content-type') || '').includes('x-www-form-urlencoded')) text = new URLSearchParams(text).get('payload') || '';
    payload = JSON.parse(text);
  } catch {
    return res.status(400).json({ error: 'invalid payload' });
  }

  let msg;
  try {
    msg = buildGithubMessage(project, src, event, payload);
  } catch (e) {
    console.error('[webhook] build failed:', event, e.message);
    return res.json({ ok: true, ignored: 'unsupported payload' });
  }
  if (!msg) return res.json({ ok: true, ignored: 'filtered' });

  try {
    await sendToChannel(project.channel_id, msg);
    await db.updateProject(project.id, { last_sent_at: new Date().toISOString(), last_error: null });
    res.json({ ok: true });
  } catch (e) {
    await db.updateProject(project.id, { last_error: explainSendError(e).slice(0, 200) }).catch(() => {});
    res.status(502).json({ error: 'send failed' });
  }
});
