# セットアップ手順(あなたがやること)

ボットのプログラム・データベース・Render・ダッシュボードはすでに用意済みです。
**パスワード類(トークン)の入力だけは安全のため手作業**になります。

Render の URL: `https://cf-mr-notifier.onrender.com`

---

## 1. Discord のボットを作る(約5分)

1. https://discord.com/developers/applications を開く → **New Application** → 好きな名前で作成
2. 左メニュー **Bot**
   - **Reset Token** → 表示された文字列をコピー(= `DISCORD_BOT_TOKEN`)※一度しか表示されません
   - 下の方の **Server Members Intent** を **ON** にして保存(メンション相手を名前で検索するため)
3. 左メニュー **OAuth2**
   - **Client ID** をコピー(= `DISCORD_CLIENT_ID`)
   - **Client Secret** の **Reset Secret** → コピー(= `DISCORD_CLIENT_SECRET`)
   - **Redirects** の **Add Redirect** に次を入力して **Save Changes**
     `https://cf-mr-notifier.onrender.com/auth/callback`

## 2. Supabase のキーを取る(約1分)

1. https://supabase.com/dashboard → プロジェクト「mr&Cf notifier」
2. **Project Settings → API Keys**
3. **service_role**(secret)の **Reveal** → コピー(= `SUPABASE_SERVICE_ROLE_KEY`)
   ※このキーは絶対に他人に見せない・GitHubに上げない

## 3. CurseForge のAPIキーを取る(約3分)

1. https://console.curseforge.com にログイン(CurseForgeアカウントでOK)
2. **API keys** → キーをコピー(= `CURSEFORGE_API_KEY`)

## 4. GitHub のトークンを作る(約3分・GitHub監視に使う)

1. GitHub → 右上アイコン → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. 名前は何でもOK / 期限は **No expiration**(または最長) / 権限は**何も追加しない**(公開リポジトリの閲覧だけで足ります)
3. 生成された文字列をコピー(= `GITHUB_TOKEN`)

## 5. Render に入力する(約3分)

1. https://dashboard.render.com → サービス **cf-mr-notifier** → 左メニュー **Environment**
2. **Add Environment Variable** で次の6つを追加(左=名前、右=コピーした値)
   - `DISCORD_BOT_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CURSEFORGE_API_KEY`
   - `GITHUB_TOKEN`
3. **Save, rebuild, and deploy** を押す → 数分待つ → 画面上部が **Live** になれば完成
   (入力前は「未入力です」というログが出て止まります。これは正常です)

## 6. UptimeRobot でスリープを防ぐ(約3分)

Render の無料プランは15分アクセスがないと眠ってしまうため、5分ごとにアクセスして起こし続けます。

1. https://uptimerobot.com で無料登録
2. **+ New monitor**
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `CF-mr-notifier`
   - URL: `https://cf-mr-notifier.onrender.com/health`
   - Monitoring Interval: **5 minutes**
3. **Create Monitor** → 緑の「Up」になればOK

## 7. ダッシュボードを公開してURLを登録する

1. Lovable でダッシュボードを **Publish**(公開URLが発行されます)
2. その公開URL(`https://xxxx.lovable.app`)を Render の環境変数 `DASHBOARD_ORIGINS` に設定
   (複数ある場合はカンマ区切り。末尾の `/` は不要)

## 8. 使い始める

1. ダッシュボードを開く → **Discordでログイン**
2. サーバーの **ボットを招待** → 招待したら画面を更新
3. **新しいプロジェクト** → 通知元を検索して追加 → 保存 → **テスト送信**
