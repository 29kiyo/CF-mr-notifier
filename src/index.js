import './env-check.js';
import express from 'express';
import cors from 'cors';
import { Events } from 'discord.js';
import { client } from './bot.js';
import { authRouter } from './auth.js';
import { apiRouter } from './api.js';
import { webhookRouter } from './webhooks.js';
import { runCycle } from './poller.js';
import { allowedOrigins, pollMs } from './config.js';

const app = express();
app.set('trust proxy', 1);

// UptimeRobot がここを定期的に叩く(Renderのスリープ防止)。HEADでもGETでも応答する。
app.get(['/', '/health'], (req, res) => {
  res.json({ ok: true, botReady: client.isReady(), uptimeSec: Math.round(process.uptime()) });
});

app.use('/auth', authRouter);
app.use('/webhooks', webhookRouter);
app.use(
  '/api',
  cors({
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }),
  apiRouter,
);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`[http] listening on :${port}`));

client.once(Events.ClientReady, (c) => {
  console.log(`[discord] logged in as ${c.user.tag} (${c.guilds.cache.size} servers)`);
  setTimeout(runCycle, 10_000);
  setInterval(runCycle, pollMs);
});

await client.login(process.env.DISCORD_BOT_TOKEN);

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
