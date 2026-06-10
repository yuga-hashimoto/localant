# 実装指示書: ダッシュボード全面動作化・拒否制セキュリティ・エンドポイント固定化

対象リポジトリ: `/Volumes/MOVESPEED/Documents/GitHub/chatgpt-local-mcp`(ブランチ `harden/security-oss-foundation`、未コミットの変更が既にある — その上に積むこと。勝手に revert しない)

## 背景(調査済みの事実 — 再調査不要)

- pnpm monorepo。`packages/shared`(config/risk/paths)、`packages/gateway`(Gateway 本体・managers・security guards・tools)、`packages/mcp`(`http-server.ts` が公開ゲートウェイ + ローカル専用ダッシュボードの2つの express サーバを起動)、`packages/dashboard`(`src/index.ts` の `dashboardHtml(token)` が**単一HTML文字列**を返す。ビルド不要・依存なし・文字列連結スタイル)、`packages/cli`。テストは `/tests`(vitest)。
- ダッシュボード API は `http-server.ts` の `mountDashboardApi()` に集約。`x-dashboard-token` ヘッダ必須。現在のルート: `GET status/health/config/mcp-endpoint/approvals/audit/skills/projects/secrets/agents`, `POST config/approvals/:id/(approve|deny)/skills/:name/(enable|disable)/secrets`, `DELETE secrets/:name`, `POST oauth/approve`。
- `Gateway`(`packages/gateway/src/gateway.ts`): `saveConfig()` は guard へは即時反映するが**トンネルには反映されない**。`gatewayPort()` が実際の bind ポートを返す。
- `TunnelManager`(`managers/tunnel-manager.ts`): `start(port)` / `stop()` / `current()`。cloudflared Quick Tunnel(`*.trycloudflare.com`)は**起動毎にURLが変わる**。`domain`(ngrok)/`subdomain`(localtunnel・serveo)/`token` は config 対応済み。
- `SkillRuntime`(`managers/skill-runtime.ts`): `list()` は `~/.localant/skills` + バンドル `examples/skills`(**hello-world の1個だけ**。これが「スキルが1つしか見えない」の正体 — バグではなく中身が無い)。`generate()`(常に disabled で生成)、`uninstall()`(バンドルは拒否)、`validate()`、`setEnabled()` あり。
- `ProjectRegistry`: `register(path, name?)` / `unregister(id)` / `list()` あり、**Web未配線**。
- `CodingAgentManager`(`managers/coding-agent-manager.ts`): `list()/status()/plan()/startTask()/getTask(id)/getLogs(id)/stopTask(id)` あり。タスク一覧メソッドが無い(`tasks` Map は private)。**enabled の切替手段が config 直編集しかない = Codex を Web から有効化できない原因**。`security.mode === "yolo"` のとき `--danger` を付与する分岐が plan/startTask にある。
- `ConfigSchema`(`packages/shared/src/config.ts`): `security.mode: z.enum(["strict","yolo"]).default("strict")`。`DEFAULT_ALLOWED_COMMANDS` / `BLOCKED_COMMAND_TOKENS` も同ファイル。
- `PathGuard` / `CommandGuard`: allowlist チェックは `mode === "strict"` のときだけ。blocklist(sensitiveBlocklist / blockedTokens / `rm -rf` / `chmod 777`)は**モード問わず常時有効**。つまり「yolo = 拒否リストのみ」の実装は既にあり、流用できる。
- 承認ゲート(`gateway.ts executeTool`): `mode === "yolo"` なら `"none"`、それ以外は `approvalFor(risk)`(risk 0→none, 1→policy次第, 2-3→single, 4→double。`packages/shared/src/risk.ts`)。
- OAuth(`http-server.ts`): `/oauth/token` は ConfigStore の**永続トークン**を返すので、トンネルURLさえ固定なら ChatGPT 側の再認証・コネクタ再作成は不要。`pendingCodes` が揮発なのは問題ない(認可フロー中のみ使用)。
- アイコン: `assets/icon.svg`(1.5KB、インライン可能)。npm パッケージに `assets/**` 同梱済み(ルート package.json の files)。現在 favicon は `hero.png` を配信、ヘッダにロゴ無し。
- ダッシュボードの `api()` ヘルパは `fetch().then(r=>r.json())` で **HTTPエラーを黙殺**。各タブのボタンが失敗しても無反応になる根因。

## やること(4フェーズ。順に実装し、各フェーズで `pnpm build && pnpm test` を通すこと)

---

### Phase 1 — セキュリティを拒否制デフォルトに(`open` モード新設)

1. `packages/shared/src/config.ts`
   - `mode: z.enum(["strict", "open", "yolo"]).default("open")` に変更。
   - `CORE_BLOCKED_COMMAND_TOKENS` を新設して export: `["sudo","su","mkfs","mkfs.ext4","dd","fdisk","diskutil","shutdown","reboot"]`(BLOCKED_COMMAND_TOKENS の部分集合)。
2. 共有型: `export type SecurityMode = "strict" | "open" | "yolo"` を shared に追加し、`PathGuard.setMode` / `CommandGuard.setMode` / 内部 `mode` フィールドの型を差し替え(ロジックは `=== "strict"` 判定のままで正しい — open/yolo は allowlist スキップ、blocklist 常時有効)。
3. `packages/gateway/src/gateway.ts` の `executeTool`:
   ```ts
   const mode = this.cfg.security.mode;
   const requirement =
     mode === "yolo" ? "none"
     : mode === "open" ? (tool.risk >= 4 ? approvalFor(tool.risk, ...) : "none")
     : approvalFor(tool.risk, { approveRisk1: ... });
   ```
   つまり open = 拒否リスト + risk4(破壊的/公開)のみ承認。
4. `Gateway.saveConfig`(または ConfigStore.save)で `security.blockedCommandTokens` に `CORE_BLOCKED_COMMAND_TOKENS` を常に union し、コアトークンを削除不能にする。
5. `coding-agent-manager.ts` の `--danger` 付与は **yolo のみ**のまま(open では付けない)。
6. テスト: `tests/command-guard.test.ts` / `tests/path-guard.test.ts` に open モードのケース追加(allowlist 外が通る・blocklist は拒否される)。デフォルトモードが strict 前提のテストがあれば open に追従。gateway の承認ゲートに open の risk3 素通し / risk4 承認要求のテスト追加。コアトークン union のテスト追加。
7. ドキュメント: README と `docs/security.md` に「デフォルトは個人利用向け `open`(拒否制)。共有環境は `strict`」を追記。`SECURITY.md` の記述と矛盾しないか確認して直す。

---

### Phase 2 — ダッシュボード API 追加(`packages/mcp/src/http-server.ts` + gateway)

事前変更:
- `Gateway` に `async restartTunnel(): Promise<TunnelInfo> { this.tunnel.stop(); return this.tunnel.start(this.gatewayPort()); }` を追加。
- `CodingAgentManager` に `listTasks()` を追加(`getTask` と同形のレコード配列、createdAt 降順。child/logs は含めない)。

`mountDashboardApi` に追加するルート(全て `{ error: string }` + 4xx のエラー契約。try/catch で 400/404 を返す):

| ルート | 動作 |
|---|---|
| `GET /api/tunnel` | `gw.tunnel.current()` |
| `POST /api/tunnel/restart` | `gw.restartTunnel()`(最大20秒かかる旨を考慮しタイムアウトさせない) |
| `POST /api/tunnel/stop` | `gw.tunnel.stop()` → current() |
| `POST /api/agents/:name/enable` / `disable` | `config.codingAgents[name]` 不在なら404。`gw.saveConfig` で enabled を書き換え、`gw.agents.list()` を返す |
| `GET /api/agents/tasks` | `gw.agents.listTasks()` |
| `GET /api/agents/tasks/:id/logs` | `{ logs: gw.agents.getLogs(id) }` |
| `POST /api/agents/tasks/:id/stop` | `gw.agents.stopTask(id)` |
| `POST /api/projects` | body `{ path, name? }` → `gw.projects.register`(PathGuard 違反等は 400 でメッセージそのまま返す) |
| `DELETE /api/projects/:id` | `gw.projects.unregister` |
| `GET /api/skills/:name` | SkillState + `gw.skills.validate(name)` + `bundled` フラグ(`!dir.startsWith(paths.skillsDir)`) |
| `POST /api/skills` | body `{ name, description, riskLevel? }` → `gw.skills.generate`(disabled で生成される旨をレスポンスに含める) |
| `DELETE /api/skills/:name` | `gw.skills.uninstall`(バンドルは 400) |

- `GET /api/skills`(既存)のレスポンスを `{ skillsDir, skills: [...] }` に変更し、各要素に `bundled` を追加(UI 側も追従)。
- 静的配信: `/icon.svg` ルートを追加(favicon と同じ候補パス探索で `assets/icon.svg`)。HTML の favicon link を `/icon.svg`(`type="image/svg+xml"`)に変更。`/favicon.png` は残してよい。
- テスト: `tests/http-server.test.ts` の流儀に合わせて新ルートのテストを追加(agents enable 404/正常、projects register のバリデーションエラー、skills create→list→uninstall、tunnel stop、icon.svg 200)。

---

### Phase 3 — ダッシュボード UI 全面改修(`packages/dashboard/src/index.ts`)

制約: 単一HTML文字列・外部依存なし・ビルド不要を維持。ファイルは TS のテンプレートリテラルなので、**中の JS はバッククォートと `${}` を使わず文字列連結**(現行スタイル踏襲)。肥大化したら `packages/dashboard/src/views/*.ts` に文字列パーツとして分割可(800行/ファイル目安)。

1. **`api()` ヘルパ修正(全タブの土台)**: `res.ok` でない、または JSON に `error` があれば throw。各ビューに共通のエラー表示領域(toast/banner)を設け、ボタン操作の失敗を必ず表示する。連打防止に実行中はボタン disable。
2. **ヘッダ**: `assets/icon.svg` の中身をインライン `<svg>`(高さ ~24px)でタイトル左に配置。favicon も `/icon.svg`。
3. **Home**:
   - トンネルカード: provider / status / URL 表示 + **Start / Stop / Restart ボタン**(restart は最大20秒、スピナー表示)。
   - URL が `trycloudflare.com` のとき警告: 「このURLは再起動ごとに変わります。Settings で固定URL(ngrok static domain / subdomain / 独自ドメイン)を設定すると ChatGPT コネクタの再作成が不要になります」。
   - MCP endpoint のコピー、ChatGPT 設定手順(既存)は維持。
4. **Skills**:
   - `{ skillsDir, skills }` 形式に追従。skillsDir をタブ上部に表示(「ここに置いたスキルが読み込まれます」)。
   - 各行展開で permissions / tools / validationErrors を表示。enable/disable は既存。非バンドルに **Uninstall**(confirm 付き)。
   - **Create skill フォーム**(name: kebab-case, description, riskLevel 0-4)→ `POST /api/skills`。「生成スキルは disabled。レビュー後に有効化」の注記。
5. **Projects**: 登録フォーム(絶対パス + 任意名)→ `POST /api/projects`。エラー(allowlist 外・存在しない等)をそのまま表示。各行に **Remove**。
6. **Agents**:
   - 各エージェント(claude-code / codex / config に足したもの全部)に **Enable/Disable トグル** → `POST /api/agents/:name/(enable|disable)`。CLI が PATH に無い(available=false)場合はトグル横に「`codex` コマンドが見つかりません」等の注記(有効化自体は許可)。
   - タスク履歴テーブル(status / mode / branch / createdAt)+ **View logs**(`<pre>` 展開)+ running 中は **Stop**。
7. **Settings**:
   - Security Mode セレクトを 3択に: `strict`(許可制)/ `open`(既定・拒否制: ブロックリストと risk4 承認のみ)/ `yolo`(承認も全廃)。説明文も更新。
   - Blocked tokens リストで `CORE_BLOCKED_COMMAND_TOKENS` は Remove ボタン非表示 + 「core」バッジ。
   - トンネル設定に **「Save & Restart Tunnel」**: config POST → `POST /api/tunnel/restart` → 新URLを表示。
   - Raw JSON を読み取り専用 `<pre>` から **編集可能 textarea + Validate & Save** に(POST /api/config に全量送信、サーバ側 Zod エラーをそのまま表示)。
   - gateway.port / dashboard.port の数値フィールド(「反映にはプロセス再起動が必要」の注記付き)。
8. **Approvals / Audit / Secrets**: 機能は現状維持、エラー表示と空状態文言だけ統一。

---

### Phase 4 — エンドポイント固定化の仕上げ

1. `packages/cli/src/runtime.ts`(起動シーケンス): Quick Tunnel(URL が trycloudflare.com)で起動したとき、コンソールに固定URL化の案内を1ブロック出す(ngrok 無料 static domain の手順1行 + `localant config` で設定可能な旨 + ダッシュボード Settings への誘導)。
2. `docs/chatgpt-setup.md` に「URLを固定する」セクション追加: (a) ngrok 無料 static domain(推奨・無料アカウントで1個もらえる → `tunnel.provider=ngrok, tunnel.token, tunnel.domain` を設定)、(b) cloudflared Named Tunnel(`tunnel.token` + `tunnel.publicUrl`)、(c) localtunnel/serveo の `tunnel.subdomain`(登録不要だが非保証)。「URLが固定なら ChatGPT コネクタの再作成も再認証も不要(トークンは永続)」と明記。README からリンク。
3. (任意・余力があれば)`localant tunnel setup` 対話コマンド。やらない場合は ROADMAP.md に追記。

---

## 検証(完了条件)

1. `pnpm build` と `pnpm test` が全て green。
2. サーバを起動し(`pnpm`/CLI の既存起動手順)、ダッシュボード(http://127.0.0.1:8788)で**全タブを実際にクリックして確認**:
   - Agents で codex を Enable → `GET /api/config` に反映、トグルが yes になる。
   - Skills で新規スキル作成 → 一覧に出る(disabled)→ enable → disable → uninstall。
   - Projects で実在ディレクトリ登録/削除、存在しないパスでエラー表示。
   - Settings でモードを open→strict→open と切替、tunnel 設定保存 → Save & Restart Tunnel(プロバイダ未導入環境ではエラーが画面に出ることを確認)。
   - ヘッダ左上にアリのロゴ、タブの favicon が icon.svg。
3. 失敗系: ダッシュボード API が 4xx を返す操作で、画面に必ずエラーメッセージが出ること(黙殺ゼロ)。
4. コミットは conventional commits(feat/fix/docs)でフェーズ単位。push はユーザー指示があるまでしない。

## やらないこと(スコープ外)

- React/Vite 化(単一HTML方針を維持)
- OAuth フローの変更(現状で再起動耐性あり)
- skill registry(リモートソース)からのインストールUI
