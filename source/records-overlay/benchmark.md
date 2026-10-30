# レコードオーバーレイのローカル比較

1. `npm run debug` を実行し、生成された `wayfarer-map-extension.user.debug.js` を
   Tampermonkey などに読み込んで Wayfarer を開きます。
2. 通常の余白なし設定で表示を安定させ、開発者ツールのコンソールに出る
   `[records-overlay benchmark]` の `full-draw`、`commit-image`、`visible-pixels`
   を記録します。
3. 同じ地図 URL に `wfmap-overlay-buffer=0.5` を追加して再読み込みし、同じ中心・
   ズーム・表示サイズ・データで同じログを記録します。`0` の場合はパラメーターを
   省略できます。
4. `full-draw` と `commit-image` の `milliseconds` を比較します。
   `visible-pixels` の `width`、`height`、`hash` が一致すれば、オーバーレイの
   画面内ピクセルが一致しています。各条件で複数回計測し、初回描画ではなく
   安定後の値を比較してください。

この計測切り替えは `npm run debug` の開発ビルドだけで有効です。通常ビルドは
余白比率 `0` のままで、計測ログも出しません。日付変更線をまたぐ表示も比較する
場合は、同じ手順で該当地域を使用してください。
