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
- **読み取る前の確認**：写真を選んでもすぐには送らない。編集画面の「◯◯で読み取る」か「Haiku と Sonnet で比べる（テスト）」を押したときだけ `askClaude(写真, signal, model)` を呼ぶ。比べるときは両方の結果を並べ、使うほうを選ぶ。あとから付けた写真も読み取れる。`max_tokens` は考える過程を含めて 4096。
- **API使用量**：返事の `usage` を localStorage `foodlog.usage`（`{"yyyy-MM": {model: {n, in, out}}}`）に足し、設定画面に今月・先月の合計を出す。料金は `PRICES`（$/100万トークン）、1ドル＝150円で換算。
- **食事の区分**：`cat`（朝食・昼食・夕食・間食）。新しい記録は時刻から自動（自分で選んだら固定）、以前の記録は `mealCat()` で時刻から決める。区分ごとに1食と数え、一覧も区分ごとに分ける。シートのC列の先頭に `［朝食］` を付け、読み込み時に外す。
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
  権限を増やしたら、利用者がApps Scriptの画面で関数を実行して許可してから `clasp redeploy` する（先にデプロイすると許可されるまで全部止まる）。
- **あとから写真**：編集画面の「写真を追加／写真を変える」（`#file2`）。AIでは読み取らず、保存時に `_photoChanged` なら `photo_put` で差し替える。
- **体重**：IndexedDB `weights` ストア（DBバージョン3、keyPath `date`=yyyy-MM-dd）。トップの体重カードにSVGの折れ線グラフ
  （目標体重は破線。日/週/月/年＝1日ごと・週平均・月平均・年平均、localStorage `foodlog.wMode`）。
  「順調なときの目安」は点線：`settings.profile.start`（目標かペースを変えたときの最新体重・日付・実際のペース kg/週）から目標へ一直線。スプレッドシートは「体重」シート（なければ末尾に作る、A日付 B体重）に
  `weight_upsert`（kg が null なら削除）/ `weight_list`。送信は記録と同じ `foodlog.queue`（id は `w:日付`）。
- **1日の目安カロリー**：`settings.profile`（性別・生まれた年・身長・活動係数・目標体重・ペース）と最新の体重から
  ミフリン・セントジョー式で基礎代謝 → ×活動係数で TDEE → 目標に向けて ペース×7200/7 kcal を増減。基礎代謝は下回らない。
- **タブ**：ヘッダーの「食事／筋トレ」（`setTab()`、localStorage `foodlog.tab`）。下のボタンもタブに合わせて切り替える。
- **筋トレ**：IndexedDB `workouts` ストア（DBバージョン4）。1件 = `{id, at(ms), items:[{name, sets:[{kg, reps}]}], memo, savedAt}`
  （kg が null なら自重）。種目名の候補は過去の種目＋ `EXERCISES`。種目を選ぶと前回のセットを入れ、「＋ セット」は直前のセットを複製。
  消費カロリーの目安 `burn()` = METs（ふつう3.5／きつめ6.0）× その日までの最新体重（未記録は60kg）× 時間 × 1.05。時間は入力がなければ1セット3分。
  食事タブの今日に「筋トレで約◯kcal消費」を出す（目安カロリーには足さない：活動量の係数に運動が含まれるため）。
  今週（月曜はじまり）の回数・セット数・総重量（kg×回）、種目ごとの最大重量のグラフと自己ベスト（推定1RMはEpley式、12回以下）。
  スプレッドシートは「筋トレ」シートに1セット1行（A日付 B時刻 C種目 Dセット E重量 F回数 G記録ID H メモ I時間 J消費kcal。H〜Jは各記録の1行目だけ）。
  `gym_upsert`（その記録IDの行を消して入れ直す）/ `gym_delete` / `gym_list`。キューの id は `g:記録ID`、記録IDは `gid` で送る。
- **その日の確定**：トップの「今日の摂取カロリーを確定する」、過去の日は見出しの「確定する」。localStorage `foodlog.closed`
  （`{日付: {kcal, target, ok, at}}`）。確定後に記録が変わると再確定を促す。
- **ドーパミン演出**：`settings.dopamine`（設定のトグル、「演出を試す」で確認）。ONで目安以内に確定すると `kakutei()` が
  虹色の『健康確定！！！』を1文字ずつ出す（集中線・虹の放射・星・閃光2回・揺れ）。閃光は2回までにしている（点滅しすぎない）。
  効果音は `fxSound()` → `buildPachinko()` で Web Audio 合成（音声ファイルなし）：キュインキュイン → 1文字ごとにドンッ＋ジャキーン（裏で8bitアルペジオ）
  → ギュイーン → クラッシュ＋歪ませた金管のパパパパーン → トレモロの和音と鈴。最後にコンプレッサーで潰して割れないようにしている。`navigator.audioSession.type = "ambient"` で iPhone の消音スイッチに従う。
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
