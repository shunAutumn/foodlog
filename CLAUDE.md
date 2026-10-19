# たべたもの記録 — プロジェクトメモ（Claude Code用）

食事の写真を撮ると、Claude APIで料理名とカロリーを読み取り、スマホ内とGoogleスプレッドシートに記録するPWA。
GitHub Pagesで公開し、iPhoneのホーム画面から単体アプリとして使う。ビルド工程はない（素のHTML/CSS/JS）。

## ファイル構成
- `index.html` — アプリ本体（CSS・JSすべて内包）
- `sw.js` — Service Worker。アプリ本体をキャッシュ（同一オリジンのGETのみ、network-first）
- `manifest.webmanifest`, `icon-*.png` — PWA設定とアイコン
- `Code.gs` — Googleスプレッドシート側のApps Script（ウェブアプリとしてデプロイ）
- `README.md` — 利用者向けのセットアップ手順

## しくみ
- **写真の読み取り**：ブラウザから `https://api.anthropic.com/v1/messages` を直接呼ぶ
  （`anthropic-dangerous-direct-browser-access: true`）。モデルは設定で選択
  （`claude-sonnet-5-5` / `claude-haiku-5-5`）。返答はJSON `{items:[{name,kcal,source}],comment}`。
  `source` は `"label"`（パッケージ等の表示から読んだ）か `"estimate"`（推定）。
- **保存**：IndexedDB（DB名 `foodlog`、ストア `meals`、keyPath `id`）。
  1件 = `{id, eatenAt(ms), items[], total, thumb(dataURL), comment, savedAt}`。
- **設定**：localStorage `foodlog.settings`（APIキー、モデル、Apps ScriptのURL、合言葉）。
  APIキーはコードやリポジトリに絶対に入れない。
- **スプレッドシート連携**：Apps ScriptのURLに `text/plain` でJSONをPOST（CORSのプリフライト回避）。
  アクション：`ping` / `list` / `upsert`（idで行を探して更新、なければ追加）/ `delete`。
  合言葉 `token` で認証。送信待ちはlocalStorage `foodlog.queue` に積み、online時・画面復帰時に再送。
- **シートの列**：A日付(yyyy/MM/dd) B時刻(H:mm) C食べたもの D合計kcal E内訳 F メモ G記録ID。
  I1に日別合計のQUERY式があるので、A〜G列以外は書き換えない。
- 撮影時刻：写真ファイルの `lastModified` が36時間以内ならそれを、それ以外は現在時刻を使う。

## 方針
- UIの文言はすべて日本語。利用者は非エンジニア。エラーは「何が起きたか＋どうすればいいか」を短く。
- 見た目：iOSネイティブ風。システムフォント、ミント系アクセント（ライト `#1FA874` / ダーク `#3DD39A`）、
  角丸大きめ、記録は写真タイル2列。色はすべて `:root` のCSS変数で、ライト/ダーク両対応を崩さない。
- safe-area（ノッチ・ホームバー）への配慮を維持する。
- `index.html` を変えたら `sw.js` の `CACHE` 名のバージョンを上げる（古いキャッシュが残らないように）。
- `Code.gs` を変えたら、利用者はApps Scriptで「デプロイを管理」→ 新バージョンで再デプロイが必要。その旨を伝える。

## 動作確認
- ローカル：`python3 -m http.server 8000` → http://localhost:8000
- 写真の読み取りには実際のAPIキーが必要（設定画面で入力）。
