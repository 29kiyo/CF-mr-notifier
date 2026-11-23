// ダッシュボードとして許可するURL(オリジン)。複数ある場合はカンマ区切り。
export const allowedOrigins = (process.env.DASHBOARD_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const pollMs = Math.max(1, Number(process.env.POLL_MINUTES) || 5) * 60 * 1000;

export function publicUrl() {
  return (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(
    /\/+$/,
    '',
  );
}
