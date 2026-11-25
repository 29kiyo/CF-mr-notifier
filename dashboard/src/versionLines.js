// ゲームバージョンを「26.1.x」「1.21.x」のような系統ごとにまとめて選べるようにする
const lineKey = (v) => {
  const m = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(v);
  return m ? `${m[1]}.${m[2]}` : null;
};

// 新しい順のバージョン一覧を受け取り、同じ系統が2つ以上あるところには「26.1.x」の項目を先頭に足して返す
export function withLineChips(list) {
  const counts = {};
  for (const v of list) {
    const k = lineKey(v);
    if (k) counts[k] = (counts[k] || 0) + 1;
  }
  const out = [];
  const done = new Set();
  for (const v of list) {
    const k = lineKey(v);
    if (k && counts[k] >= 2 && !done.has(k)) {
      done.add(k);
      out.push(`${k}.x`);
    }
    out.push(v);
  }
  return out;
}

export const isLineChip = (v) => /\.[*xX]$/.test(v);
