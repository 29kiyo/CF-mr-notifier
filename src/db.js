import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function must({ data, error }) {
  if (error) throw new Error(`DB: ${error.message}`);
  return data;
}

const WITH_SOURCES = '*, sources:notifier_sources(*)';

export async function listProjects(guildId) {
  return must(
    await sb.from('notifier_projects').select(WITH_SOURCES).eq('guild_id', guildId).order('created_at', { ascending: true }),
  );
}

export async function listEnabledProjects() {
  return must(await sb.from('notifier_projects').select(WITH_SOURCES).eq('enabled', true));
}

export async function getProject(id) {
  return must(await sb.from('notifier_projects').select(WITH_SOURCES).eq('id', id).maybeSingle());
}

export async function countProjects(guildId) {
  const { count, error } = await sb
    .from('notifier_projects')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId);
  if (error) throw new Error(`DB: ${error.message}`);
  return count ?? 0;
}

export async function createProject(row) {
  return must(await sb.from('notifier_projects').insert(row).select().single());
}

export async function updateProject(id, patch) {
  return must(
    await sb.from('notifier_projects').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single(),
  );
}

export async function deleteProject(id) {
  must(await sb.from('notifier_projects').delete().eq('id', id));
}

export async function addSource(row) {
  return must(await sb.from('notifier_sources').insert(row).select().single());
}

export async function updateSource(id, patch) {
  must(await sb.from('notifier_sources').update(patch).eq('id', id));
}

export async function deleteSource(id) {
  must(await sb.from('notifier_sources').delete().eq('id', id));
}

export async function getSeenIds(sourceId) {
  const out = new Set();
  for (let from = 0; ; from += 1000) {
    const rows = must(
      await sb.from('notifier_seen').select('version_id').eq('source_id', sourceId).range(from, from + 999),
    );
    rows.forEach((r) => out.add(r.version_id));
    if (rows.length < 1000) break;
  }
  return out;
}

export async function markSeen(sourceId, versionIds) {
  const ids = [...new Set(versionIds)];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = ids.slice(i, i + 500).map((version_id) => ({ source_id: sourceId, version_id }));
    must(await sb.from('notifier_seen').upsert(rows, { onConflict: 'source_id,version_id', ignoreDuplicates: true }));
  }
}
