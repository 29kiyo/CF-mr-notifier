import './env-check.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Events } from 'discord.js';
import { client } from './bot.js';
import { authRouter } from './auth.js';
import { apiRouter } from './api.js';
import { webhookRouter } from './webhooks.js';
import { runCycle } from './poller.js';
import { allowedOrigins, pollMs } from './config.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// セキュリティ用のHTTPヘッダー(HTTPS強制・MIMEタイプ固定・リファラ制限など)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, referrerPolicy: { policy: 'no-referrer' } }));

// UptimeRobot がここを定期的に叩く(Renderのスリープ防止)。HEADでもGETでも応答する。
app.get(['/', '/health'], (req, res) => {
  res.json({ ok: true, botReady: client.isReady() });
});

const limit = (max, windowMs, message) =>
  rateLimit({ windowMs, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: message } });
const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

app.use('/auth', noStore, limit(30, 5 * 60 * 1000, 'ログインの試行が多すぎます。しばらく待ってからお試しください'), authRouter);
// GitHubからのWebhook(署名の確認は webhooks.js で行う)。大量の偽リクエスト対策として回数を制限する。
app.use('/webhooks', limit(600, 60 * 1000, 'too many requests'), webhookRouter);
app.use(
  '/api',
  noStore,
  limit(300, 60 * 1000, 'アクセスが多すぎます。少し待ってからもう一度お試しください'),
  cors({
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }),
  apiRouter,
);

// 想定外のエラーでも内部の情報(スタックトレース等)を返さない
app.use((err, req, res, next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error('[http]', req.method, req.path, err.message);
  res.status(status).json({ error: status === 413 ? 'データが大きすぎます' : 'リクエストを処理できませんでした' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`[http] listening on :${port}`));

client.once(Events.ClientReady, (c) => {
  console.log(`[discord] logged in as ${c.user.tag} (${c.guilds.cache.size} servers)`);
  setTimeout(runCycle, 10_000);
  setInterval(runCycle, pollMs);
});

await client.login(process.env.DISCORD_BOT_TOKEN);

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
