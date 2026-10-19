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
  （`claude-sonnet-5-5` / `claude-haiku-5-5`）。返答はJSON `{items:[{name,g,kcal,p,f,c,sugar,source}],comment}`（p/f/c/sugar はたんぱく質・脂質・炭水化物・糖質のg。アプリ内では sugar を s で持つ）。
  `source` は `"label"`（パッケージ等の表示から読んだ）か `"estimate"`（推定）。手で直すと `"manual"`。
- **手入力**：下の「手入力」ボタン。写真なし・AIなしで同じ編集画面を開く。
- **料理名の候補（AIなし）**：過去の記録（「前回」）と、`index.html` 内の目安表 `FOODS`（「目安」、
  `名前|量のめやす|よみ|g|kcal`）から出す。`norm()` でカタカナ→ひらがな等をそろえ、入力途中のひらがなでも当たる。
  グラムを変えるとカロリーと栄養素は `_base`（その時点のg・kcal・栄養素、保存しない）から `scaleTo()` で比例して変わる。
  栄養素は任意（品目の「栄養素」で開く）。値がないものは null で、0g とは区別する。目安表 `FOODS` には栄養素はない。
- **保存**：IndexedDB（DB名 `foodlog`、ストア `meals`、keyPath `id`）。
  1件 = `{id, eatenAt(ms), items[{name,g,kcal,p,f,c,s,source}], total, thumb(dataURL), comment, savedAt}`。
- **設定**：localStorage `foodlog.settings`（APIキー、モデル、Apps ScriptのURL、合言葉）。
  APIキーはコードやリポジトリに絶対に入れない。
- **スプレッドシート連携**：Apps ScriptのURLに `text/plain` でJSONをPOST（CORSのプリフライト回避）。
  アクション：`ping` / `list` / `upsert`（idで行を探して更新、なければ追加）/ `delete`。
  合言葉 `token` で認証。送信待ちはlocalStorage `foodlog.queue` に積み、online時・画面復帰時に再送。
- **シートの列**：A日付(yyyy/MM/dd) B時刻(H:mm) C食べたもの D合計kcal E内訳 F メモ G記録ID。
  E内訳は `ご飯 150g 234kcal［P3.8 F0.5 C55.7 糖質53.4］、みそ汁 40kcal（表示）` の形（gは0なら省く）。読み込み時は `parseDetail()` で品目に戻す。
  I1に日別合計のQUERY式があるので、A〜G列以外は書き換えない。
- **写真の保存**：新しく撮った写真（長辺1400px）はIndexedDBの `photos` ストア（DBバージョン2）に置き、
  localStorage `foodlog.photoq` の順に Apps Script の `photo_put` でGoogleドライブ「たべたもの記録の写真」へ送り、送れたら消す。
  写真の送信は記録の送信（`foodlog.queue`）とは別で、失敗しても記録は止めない。ファイル名の末尾が記録ID。
  `photo_get` で取り戻す（シートから読み込むとき）。`delete` で写真もごみ箱へ。`ifMissing` はドライブにないときだけ送る
  （機能追加前の記録の小さい写真を一度だけ送るため。`foodlog.oldPhotosSent`）。
  Apps Scriptの権限は `appsscript.json` の `oauthScopes`（spreadsheets.currentonly / drive.file / script.external_request）。
  DriveApp は drive.file では使えない（ドライブ全体の権限を要求する）ので、拡張サービス Drive（v3）を使う。写真の取得は UrlFetchApp で alt=media。
- **あとから写真**：編集画面の「写真を追加／写真を変える」（`#file2`）。AIでは読み取らず、保存時に `_photoChanged` なら `photo_put` で差し替える。
  権限を増やしたら、利用者がApps Scriptの画面で関数を実行して許可してから `clasp redeploy` する（先にデプロイすると許可されるまで全部止まる）。
- **引っ越し**（設定画面）：iOSではSafariとホーム画面のアプリで保存場所が別なので、
  `foodlog-move:` + JSON `{v:1, settings, meals, queue}` をクリップボード経由で移す。
  記録はidごとに `savedAt` が新しいほうを残す。取り込み後はクリップボードを空にする（APIキーを残さない）。
- 撮影時刻：写真ファイルの `lastModified` が36時間以内ならそれを、それ以外は現在時刻を使う。

## 方針
- UIの文言はすべて日本語。利用者は非エンジニア。エラーは「何が起きたか＋どうすればいいか」を短く。
- 見た目：iOSネイティブ風。システムフォント、ミント系アクセント（ライト `#1FA874` / ダーク `#3DD39A`）、
  角丸大きめ、記録は写真タイル2列。色はすべて `:root` のCSS変数で、ライト/ダーク両対応を崩さない。
- safe-area（ノッチ・ホームバー）への配慮を維持する。
- `index.html` を変えたら `sw.js` の `CACHE` 名のバージョンを上げる（古いキャッシュが残らないように）。
- `Code.gs` を変えたら clasp で反映する（ログイン済み、`.clasp.json` 設定済み、`.claspignore` で `Code.gs` と `appsscript.json` だけ送る）：
  `clasp push -f` → `clasp redeploy AKfycbzt8huL_vX0KwmeQXiTqzvFaHs6bIMv2g5slqvyWiPX0VfykgLxQNS28x8KMhw0ADf-Tw -d "変更内容"`。
  このデプロイIDを使えばアプリに入れたURLは変わらない（`clasp deploy` で新規デプロイを作らない）。
- 合言葉はスクリプト プロパティ `TOKEN` に入っている。コード・リポジトリには書かない（公開リポジトリ）。

## 動作確認
- ローカル：`python3 -m http.server 8000` → http://localhost:8000
- 写真の読み取りには実際のAPIキーが必要（設定画面で入力）。
