# AGENTS.md

このファイルは、Claude Code、Codex、その他のエージェントがこのリポジトリを安全に共同編集するための作業規約です。

## Product goal

macOS上のClaude CodeとCodexのタスクをStream Deck Neoへ表示し、ユーザーが別作業中でも確認待ちに気づき、該当タスクへ戻れるようにします。

## Before editing

1. `git status -sb` で既存変更を確認する。
2. 他エージェントまたはユーザーの変更を上書きしない。
3. 同じファイルに未コミット変更がある場合は、差分を読み、担当範囲が重なるなら先に調整する。
4. `dist/`、`node_modules/`、`com.atsu.claude-code-status.sdPlugin/bin/` は生成物なので直接編集しない。
5. 調査と実装を分け、外部仕様を参照した場合は一次ソースを優先する。

## Product invariants

変更時は次を維持してください。

- ClaudeとCodexの実タスクは、状態ではなく `updatedAt` の降順で混在表示する。
- 1ページ目はClaude概要、Codex概要、最新順5タスク、統合利用率の8キーを基本とする。
- 2ページ目は最終更新日時順の続き8タスクとし、2ページ合計で13タスクを表示する。
- タスクキーの短押しは起動元アプリを前面にし、`確認待ち` のキーを0.8秒以上長押しした場合だけ確認済みとして表示対象から外す。
- 概要キーは表示専用で、押しても状態を変更しない。
- 返信完了後は、ユーザーが確認できるまで `確認待ち` を維持する。
- Claude/Codex側でタスク終了またはアーカイブされたものと、8時間以上更新がないものを表示対象から外す。
- チャット名の変更だけでタスクの並び順を変えない。
- Claudeはオレンジ、Codexは青の枠とロゴ、背景は黒、基本文字色は白とする。
- `確認待ち` はシアン文字と赤いマーカー、`作業中` はミントグリーン文字と回転表示を使う。
- 状態とセッション名は16px、更新時間は14pxを基準とし、実機で読めない小さな補助文字を追加しない。
- Claude利用量APIは5分より短い間隔で呼ばない。HTTP 429では `Retry-After` または最低5分のクールダウンを守る。
- 利用量の描画更新やキー操作で、Claude APIの最短間隔・クールダウンを迂回しない。
- API失敗時は直前成功値、次に有効なローカル値を優先し、不要な `ERR` 点滅を避ける。
- 認証トークン、Cookie、APIレスポンス本文、会話本文、ツール入出力を保存・ログ出力しない。

## Architecture map

- `src/plugin.ts`: プラグインの起動、アクション登録、タイマー
- `src/status.ts`: 状態モデル、同期、並べ替え、スナップショット
- `src/status-action.ts`: Stream Deckの概要・タスクアクション
- `src/session-press.ts`: タスクキーの短押し・長押し判定
- `src/render.ts`: 概要・タスクキーのSVG
- `src/codex-task-monitor.ts`: Codexローカルタスクの監視
- `src/claude-task-name.ts`: Claudeローカルタイトルの解決
- `src/claude-remote-title.ts`: Claude Remote Controlタイトルの解決
- `src/session-app.ts`: 起動元アプリの検出とフォールバック
- `src/usage.ts`: 利用率、キャッシュ、認証、バックオフ
- `src/usage-render.ts`: 統合利用率キーのSVG
- `src/server.ts`: `127.0.0.1:37654` のフック受信
- `scripts/install-hooks.mjs`: Claude Codeフックの安全なマージ
- `scripts/install-codex-hooks.mjs`: Codexフックの安全なマージ
- `test/`: Node test runnerによる回帰テスト

## Hook installer rules

- 既存設定全体を置き換えない。
- 専用markerを持つエントリだけを追加・更新・削除する。
- インストールは冪等にする。同じフックを重複追加しない。
- 変更前にバックアップを作る。
- read後write前にファイルが変化した場合は、上書きせず失敗させる。
- 送信先はlocalhost固定とし、短いtimeoutでエージェント処理を妨げない。

## Validation

実装変更後は、リスクに応じて次を実行します。リリース前はすべて必須です。

```sh
npm run check
npm test
npm run build
npm run validate
npm run pack
```

表示変更時:

```sh
npm run preview
```

- 生成した `assets/readme-preview.svg` またはStream Deckアプリを目視確認する。
- 状態、タスク名、更新時間がキーの枠内に収まり、実機で読めることを確認する。
- 利用率変更時はClaude/Codexを別々に失敗させ、一方の失敗が他方を壊さないことをテストする。
- タスク起動変更時は検出先、deep link、公式アプリへのフォールバック順をテストする。

## Generated files

- `dist/` と `com.atsu.claude-code-status.sdPlugin/bin/` はビルド生成物で、Gitへ追加しない。
- `assets/readme-preview.svg` は公開ドキュメント用の匿名データだけで生成し、Gitへ追加する。
- 実ユーザーのセッション名、リポジトリ名、利用率、画面全体をREADME画像へ含めない。

## Versioning and release

バージョンは次の3箇所を同時に更新します。

- `package.json`: `x.y.z`
- `package-lock.json`: `x.y.z`
- `com.atsu.claude-code-status.sdPlugin/manifest.json`: `x.y.z.0`

リリースはユーザーが依頼または承認した場合だけ行います。現在のリポジトリ運用では、検証済み変更を`main`へコミットし、annotated tag `vx.y.z` を作成してpushします。タグは既存コミットから移動・上書きしません。

コミット前に対象ファイルだけをstageし、無関係な変更を含めないでください。push後はremoteの`main`、タグのdereference先、clean worktreeを再確認します。

## Documentation

- `README.md` は英語のメイン文書、`README.ja.md` は日本語版とし、両方の先頭から言語を切り替えられるようにする。
- 英語版と日本語版の機能、導入手順、取得元、通信頻度、フォールバック、プライバシー説明を一致させる。
- READMEの表示仕様、取得元、通信頻度、フォールバックは実装と一致させる。
- 外部APIや第三者実装を参考にした場合はリンクと、採用した考え方を記載する。
- 機密情報、ローカルの個人名、実セッション名、絶対パスを公開ドキュメントへ書かない。
