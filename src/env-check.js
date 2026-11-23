const REQUIRED = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_SECRET',
];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('[起動失敗] 次の設定(環境変数)が未入力です: ' + missing.join(', '));
  console.error('Render の Environment 画面で入力してください。');
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 16) {
  console.error('[起動失敗] SESSION_SECRET が短すぎます(16文字以上にしてください)');
  process.exit(1);
}
