# OpenAI Apps SDK 公式ドキュメント 分析 & 追加改善計画

## 前回との差分

前回は openai-apps-sdk-examples リポジトリのコードのみ分析したが、公式ドキュメント
(`developers.openai.com/apps-sdk/`) にはさらに重要な情報があった。

## 新たに発見した改善項目

### 1. MCP Apps Bridge (JSON-RPC over postMessage) — 推奨方式

**公式推奨**: 「新しいアプリでは MCP Apps ブリッジ（JSON-RPC over postMessage）を
使え。`window.openai` は後方互換性のため。」

現在 LocalAnt のランタイムは `window.openai.callTool()` を使っており、
公式推奨の JSON-RPC 方式を使っていない。

| メソッド | 用途 | LocalAnt 現状 |
|---|---|---|
| `tools/call` | ツール呼び出し | ❌ `window.openai.callTool()` |
| `ui/message` | フォローアップ発話 | ❌ PR#52 で `sendFollowUpMessage` 追加中 |
| `ui/update-model-context` | モデル可視状態更新 | ❌ 未実装 |
| `ui/notifications/tool-result` | ツール結果受信 | ✅ 実装済み |
| `ui/notifications/tool-input` | ツール入力受信 | ❌ 未実装だが現状不要 |

**対応**: WIDGET_RUNTIME に JSON-RPC ブリッジを追加し、`callTool` / `sendFollowUpMessage`
を JSON-RPC ベースに切り替え。`updateModelContext` を新規追加。フォールバックで
`window.openai` API も維持。

### 2. `ui/update-model-context`

widget内のユーザー操作（選択、フィルタ等）をモデルに伝える標準API。

```js
await ctx.updateModelContext("ユーザーは3つのファイルをステージングしました");
```

**価値**: git-panel で「ユーザーがステージングした」ことをモデルが認識できる。
approval-center で「このタスクだけ承認スキップ」をモデルに伝えられる。

### 3. `openai/closeWidget` — 自動クローズ

ツール戻り値 `_meta` に `openai/closeWidget: true` を設定すると widget を閉じる。

**活用例**: approval-center で全件承認後、不要な空白widgetを消せる。

### 4. Decoupled Data/Render Tool パターン（長期アーキテクチャ改善）

**現状**: データツールに直接widgetテンプレートをバインド
```
approval_list_pending → [_meta: outputTemplate] → approval-center window
```

**推奨**: データツールは `structuredContent` のみ返し、描画専用ツールが widget を表示
```
データツール(approval_list_pending) → structuredContent(描画なし)
  → ChatGPTがデータ検証
  → 描画ツール(render_approval_center) → widget表示
```

**ただし**: 大規模リファクタリングになる。現状でも動作するため **優先度低**。

## 優先順位付き実装計画

### Phase 1: JSON-RPC ブリッジ対応 (高)

**ファイル**: `packages/mcp/src/widgets/runtime.ts`

1. JSON-RPC リクエスト/レスポンスユーティリティを追加
2. `ctx.callTool` を `tools/call` JSON-RPC 経由に、フォールバックで従来APIも維持
3. `ctx.sendFollowUpMessage` を `ui/message` に切り替え
4. `ctx.updateModelContext(text)` を新規追加（`ui/update-model-context`）
5. postMessage リスナーに JSON-RPC 応答処理を追加

### Phase 2: `openai/closeWidget` の活用 (中)

**ファイル**: `packages/mcp/src/mcp-server.ts`

- ツールハンドラで「全承認完了」等のケースで widget を閉じられるよう対応
- `closeWidget: true` フラグをツールコンテキストから設定可能にする

### Phase 3: Decoupled パターン (低)

**着手しない。** 現状の方式で実用上問題ない。

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `packages/mcp/src/widgets/runtime.ts` | JSON-RPC ブリッジ、callTool/ sendFollowUpMessage 切り替え、updateModelContext 追加 |
| `packages/mcp/src/mcp-server.ts` | `openai/closeWidget` 対応（必要に応じて） |
| `packages/mcp/src/widgets/index.ts` | 変更不要（PR#52 済み） |

## テスト方法

1. `pnpm build` でビルド
2. ChatGPT Developer Mode でコネクターとして追加
3. approval-center, git-panel 等で `callTool` が動作することを確認
4. `window.openai` が無い環境でも JSON-RPC フォールバックが効くことを確認
