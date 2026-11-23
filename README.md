# CF-mr-notifier

Modrinth / CurseForge / GitHub の更新を Discord に通知するボット。設定はダッシュボード(Web)から行います。

- ボット本体: `src/` (Render で常時起動)
- データ保存: Supabase (`supabase/schema.sql`)
- ダッシュボード: Lovable で作成(別プロジェクト)

## 構成

```
ダッシュボード(Lovable) ──Discordログイン──> ボットのAPI(Render) ──> Supabase
                                              │
                                              ├─ Modrinth / CurseForge / GitHub を5分ごとに確認
                                              └─ Discord に通知
UptimeRobot ──5分ごとに /health を開く──> Render のスリープ防止
```

## 環境変数(Render の Environment に設定)

`.env.example` を参照。秘密の値(トークン等)は GitHub に上げないこと。

## 主なAPI

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/health` | 生存確認(UptimeRobot用) |
| GET | `/auth/login?return=<ダッシュボードURL>` | Discordログイン開始 |
| GET | `/api/me` | ログイン中ユーザーと管理可能サーバー |
| GET | `/api/options` | 絞り込み候補(バージョン/ローダー) |
| GET | `/api/search?platform=&type=&q=` | プロジェクト検索 |
| GET | `/api/guilds/:gid/meta` | チャンネル/ロール一覧 |
| GET | `/api/guilds/:gid/members?q=` | メンバー検索 |
| GET/POST | `/api/guilds/:gid/projects` | プロジェクト一覧/作成 |
| PUT/DELETE | `/api/guilds/:gid/projects/:pid` | 更新/削除 |
| POST | `/api/guilds/:gid/projects/:pid/test` | テスト送信 |
| POST | `/api/guilds/:gid/projects/:pid/check` | 今すぐチェック |
