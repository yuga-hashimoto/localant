<p align="center">
  <img src="assets/hero.png" width="320" alt="LocalAnt — ChatGPT ネイティブのローカル MCP ゲートウェイ" />
</p>

# LocalAnt

<p align="center">
  <a href="https://github.com/yuga-hashimoto/localant/actions/workflows/ci.yml"><img src="https://github.com/yuga-hashimoto/localant/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/localant"><img src="https://img.shields.io/npm/v/localant.svg" alt="npm version" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/localant.svg" alt="node version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>日本語</b>
</p>

> **ChatGPT を頭脳に、あなたのローカル PC を手足にする。**

`LocalAnt` は、ChatGPT を頭脳として、ローカル PC を実行環境として使うための
ツールです。

安全で権限管理された「スキル」を MCP 経由で ChatGPT に公開します。
許可済みコマンドの実行、プロジェクトの調査、ファイル操作、Claude Code や Codex
などのコーディングエージェントの呼び出し、ブラウザ / ADB の操作、記事の公開、
独自スキルの作成 —— すべてが**権限管理・ローカル承認・完全な監査ログ**の背後で
動作します（既定は deny-list、`strict` で allow-list）。

```text
ChatGPT
  ↓ Apps SDK / MCP コネクタ（Streamable HTTP /mcp）
LocalAnt  ── ゲートウェイ · リスクエンジン · 承認キュー · 監査ログ · ダッシュボード
  ↓ ローカル PC
  ├─ シェル · ファイルシステム · Git（既定は deny-list・strict モードで allow-list）
  ├─ Claude Code / Codex（計画 → 承認 → 実行 → 検証 → 差分）
  ├─ ブラウザ（Playwright・分離プロファイル）· Android（ADB）
  ├─ 記事（Zenn / Qiita / note・スキルで提供）· カスタムスキル
  └─ アダプタ: OpenClaw · Desktop Commander · 任意の MCP サーバ
```

---

## LocalAnt とは？

ChatGPT のための**ローカルファースト MCP ゲートウェイ**です。ChatGPT は会話 UI
兼意思決定者、あなたの PC が実行環境になります。ゲートウェイは **200 以上の権限
管理されたツール**を Model Context Protocol で公開し、ChatGPT の開発者モード
コネクタから呼び出せます。

## なぜ ChatGPT が頭脳で、ローカル PC が手足なのか？

- ChatGPT は推論・計画・会話が得意です。
- あなたの PC には、実際のコード・ファイル・デバイス・ツールがあります。
- ChatGPT に生のシェルを渡すのは危険です。代わりに、リスクの高い操作はローカル
  承認を挟んだ**厳選された権限付きの操作面**を提供します。

## 特長

- 🔒 **多層セキュリティ**: 既定は deny-list（機密パスの blocklist + 常時ブロック
  コマンド）、任意で `strict` の allow-list モード、パス・シンボリックリンクの
  トラバーサル防止、シークレット保管庫 + マスキング。
- ✅ **ローカル承認キュー**: リスク2以上のツールはダッシュボードまたは CLI での
  明示的な承認が必須。ChatGPT 側の確認だけでは決して信用しません。
- 🧾 **完全な監査ログ**: すべてのツール呼び出しを記録（シークレットはマスキング）。
- 🧩 **スキルシステム**: 作成・検証・有効化・実行・git からの導入・公開、そして
  **ChatGPT からのスキル生成**（常に無効状態で保存）。
- 🤖 **コーディングエージェント**: Claude Code / Codex を任意の作業ディレクトリで
  駆動（計画 → 承認 → 実行 → 検証 → 差分）。
- 🖥️ **ローカルダッシュボード**: ホーム・ツール（スキル / MCP サブタブ）・
  セキュリティ・承認・監査・シークレット・エージェント・設定。
- 🌐 **3分セットアップ**: Cloudflare Tunnel / ngrok とクリップボードコピー対応。
- 🔌 **アダプタ**: OpenClaw、Desktop Commander、任意の MCP サーバ。

## 3分セットアップ

```bash
npx -y localant setup
```

または：

```bash
npm install -g localant
localant setup
```

`setup` は環境チェック、設定の初期化、認証トークン生成、組み込みスキルの有効化、
ゲートウェイ + ダッシュボードの起動、公開トンネルの作成、MCP URL のクリップボード
コピー、ChatGPT 接続手順の表示までを行います。

## ChatGPT の設定

1. ChatGPT →**設定 → アプリとコネクタ**
2. **詳細設定 → 開発者モードをオン**
3. **コネクタ → 作成**
4. **MCP URL**（`https://…/mcp?key=<token>`）を貼り付け
5. **認証**を**なし**にする（URLにトークンが含まれているため）
6. 名前を **LocalAnt** にする
7. ChatGPT に「ローカルアプリのヘルスチェックを実行して」と頼む

トークンは URL に埋め込まれているため、カスタムヘッダが使えない環境でもコネクタ
が認証できます。`Authorization: Bearer <token>` も利用できます（こちらを推奨）。
詳細は [docs/chatgpt-setup.md](docs/chatgpt-setup.md)。

## セキュリティモデル

3つのセキュリティモードがあります（`security.mode` を設定 or ダッシュボードの
設定タブで変更）:

| モード | ファイルシステム / シェル | 承認ゲート | 用途 |
|------|--------------------|----------|-----|
| **`open`**（既定） | deny-list — blocklist + コア禁止コマンド以外はすべて許可 | risk-4（破壊的/公開）のみ | 個人の単一ユーザー環境 |
| `strict` | allow-list — 許可ディレクトリ / コマンドのみ | リスク別（下表） | 共有 / マルチユーザー環境 |
| `yolo` | deny-list（`open` と同じ） | 一切なし | 信頼できる自動化のみ |

**`strict` モードの承認マトリクス**（`open` では risk-4 以外すべて不要、`yolo` では一切不要）:

| リスク | 意味 | 承認（strict） |
|------|---------|------|
| 0 | 読み取り専用 | 不要 |
| 1 | 安全な下書き書き込み | 設定次第（既定は不要） |
| 2 | ファイル変更 | **必須** |
| 3 | シェル / エージェント / ネットワーク書き込み | **必須** |
| 4 | 破壊的 / 公開 / デプロイ | **二重承認** |

**どのモードでも常に強制（`open` / `yolo` を含む）:**

- 機微なパス（`~/.ssh`、`~/.aws`、`~/.gnupg`、`/etc` など）は読み書き不可。
  シンボリックリンクによる脱出も検出します。
- コア禁止コマンド（`sudo`、`su`、`dd`、`mkfs`、`fdisk`、`diskutil`、`shutdown`、
  `reboot`）と `rm -rf` / `chmod 777` は常に拒否され、blocklist から外せません。
- シークレットは暗号化されたローカル保管庫に保存され、ツール出力・監査ログから
  **マスキング**されます。
- 生成 / 導入したスキルはレビューするまで**既定で無効**です。

詳細は [SECURITY.md](SECURITY.md)。トークンは秘密を失わずに
`localant token rotate` でいつでも再発行できます。

## スキル

スキルは拡張の単位です。

```text
skills/<name>/
  skill.json     # マニフェスト: 権限 + リスク + ツールスキーマ
  README.md  LICENSE  CHANGELOG.md
  src/index.ts   # defineSkill({...})
  tests/index.test.ts
  examples/
```

```ts
import { defineSkill, z } from "@localant/skill-sdk";

export default defineSkill({
  name: "hello-world",
  tools: {
    hello: {
      description: "Say hello",
      riskLevel: 0,
      inputSchema: z.object({ name: z.string() }),
      handler: async ({ name }) => ({ content: `Hello ${name}` }),
    },
  },
});
```

詳細は [docs/skills.md](docs/skills.md)。

## 記事の公開

記事公開はバンドル済みの **`article-publisher` スキル**が提供します（既定で無効
—— `skill_enable` / `localant skills enable article-publisher` で有効化）:

- **Zenn**: GitHub リポジトリ方式。`published:false` で `articles/<slug>.md` を
  書き出し、PR ブランチも作成可能。（`zenn_*`）
- **Qiita**: 保管庫の `QIITA_TOKEN` を使った公式 API。非公開を優先。（`qiita_*`）
- **note**: ローカル下書きのみ（note に公式の公開 API はありません）。（`note_*`）

公開操作は**リスク4（二重承認）**です。詳細は [docs/articles.md](docs/articles.md)。

## CLI

```bash
localant setup | start | stop | restart | status | doctor | update | uninstall
localant token rotate | show   # 認証トークンを再発行（シークレットは保持）
localant tunnel status
localant approvals list | approve <id> [--session] | deny <id>
localant skills list | info <name> | enable <name> | disable <name> | install <git-url>
localant agents list | detect | run <agent> <cwd> <task> [--execute] | logs <taskId> | stop <taskId>
localant secrets set <name> [value] | list | remove <name>
```

## コントリビュート

コントリビューション歓迎です（特にテストとセキュリティ強化）。セットアップ・
コーディング規約・リリース手順は [CONTRIBUTING.md](CONTRIBUTING.md)、今後の方針は
[ROADMAP.md](ROADMAP.md) を参照してください。脆弱性は
[SECURITY.md](SECURITY.md) に従って非公開で報告してください。

## ライセンス

MIT —— [LICENSE](LICENSE) を参照。
