import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } from 'discord.js';

export const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.on('error', (e) => console.error('[discord] error:', e.message));

// 表示 / 送信 / 埋め込み / ロールメンション
export const INVITE_PERMISSIONS = '150528';

export function inviteUrl(guildId) {
  const p = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    scope: 'bot',
    permissions: INVITE_PERMISSIONS,
  });
  if (guildId) {
    p.set('guild_id', guildId);
    p.set('disable_guild_select', 'true');
  }
  return `https://discord.com/oauth2/authorize?${p}`;
}

export const botInGuild = (id) => client.guilds.cache.has(id);

export async function guildMeta(guildId) {
  const g = client.guilds.cache.get(guildId);
  if (!g) return null;
  const me = await g.members.fetchMe();
  const need = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ];
  const channels = g.channels.cache
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.parent?.name ?? null,
      canSend: c.permissionsFor(me)?.has(need) ?? false,
    }));
  const roles = g.roles.cache
    .filter((r) => r.id !== g.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.hexColor === '#000000' ? null : r.hexColor,
      mentionable: r.mentionable,
      managed: r.managed,
    }));
  return {
    id: g.id,
    name: g.name,
    iconUrl: g.iconURL({ size: 128 }),
    channels: Array.from(channels),
    roles: Array.from(roles),
    canMentionAll: me.permissions.has(PermissionFlagsBits.MentionEveryone),
  };
}

export async function searchMembers(guildId, q) {
  const g = client.guilds.cache.get(guildId);
  if (!g) return [];
  const list = q ? await g.members.search({ query: q, limit: 10 }) : await g.members.list({ limit: 20 });
  return Array.from(
    list.map((m) => ({
      id: m.id,
      username: m.user.username,
      displayName: m.displayName,
      avatarUrl: m.displayAvatarURL({ size: 64 }),
      bot: m.user.bot,
    })),
  );
}

export async function sendToChannel(channelId, payload) {
  const ch = await client.channels.fetch(channelId);
  if (!ch || typeof ch.send !== 'function') throw new Error('通知チャンネルが見つかりません');
  return ch.send(payload);
}

export function explainSendError(e) {
  switch (e?.code) {
    case 50013:
      return 'ボットにこのチャンネルへの送信権限がありません';
    case 50001:
      return 'ボットがこのチャンネルを見られません(権限不足)';
    case 10003:
      return '通知チャンネルが削除されています';
    default:
      return e?.message || '送信に失敗しました';
  }
}

export async function resolveMembers(guildId, ids) {
  const g = client.guilds.cache.get(guildId);
  if (!g) return [];
  const out = [];
  await Promise.all(
    ids.slice(0, 10).map(async (id) => {
      try {
        const m = await g.members.fetch(id);
        out.push({ id: m.id, username: m.user.username, displayName: m.displayName, avatarUrl: m.displayAvatarURL({ size: 64 }), bot: m.user.bot });
      } catch {
        try {
          const u = await client.users.fetch(id);
          out.push({ id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.displayAvatarURL({ size: 64 }), bot: u.bot });
        } catch {
          // skip users that cannot be fetched
        }
      }
    }),
  );
  return out;
}
// ダッシュボードを操作している人が、今もそのサーバーの管理権限を持っているか確認する(60秒キャッシュ)。
// true=持っている / false=持っていない / null=確認できなかった
const permCache = new Map();
export async function canManageGuild(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const hit = permCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.ok;
  const g = client.guilds.cache.get(guildId);
  if (!g) return false;
  let ok;
  try {
    if (g.ownerId === userId) ok = true;
    else {
      const m = await g.members.fetch(userId);
      ok = m.permissions.has(PermissionFlagsBits.Administrator) || m.permissions.has(PermissionFlagsBits.ManageGuild);
    }
  } catch (e) {
    if (e?.code === 10007 || e?.code === 10013) ok = false; // サーバーにいない
    else return null;
  }
  permCache.set(key, { ok, exp: Date.now() + 60_000 });
  return ok;
}