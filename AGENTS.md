# エージェント向けプロジェクト指示

## 描画処理の調査・高速化

- 描画を高速化するときは、変更前に対象区間と計測方法を決め、その処理を実行する自動ベンチを用意する。計測できない場合は、ベンチ対象を狭めるか、先に計測可能な構成を整える。
- `npm run benchmark` はラベル衝突判定のCPU比較であり、Canvas/WebGL描画時間ではない。描画性能の根拠として流用しない。
- `npm run benchmark:canvas` はPlaywrightのChromiumでPixiJSのメッシュ生成器とシェーダーを使うCanvas/WebGLベンチ。初回のみ `npx playwright install chromium` が必要。ベンチ仕様と計測対象外の処理は [source/records-overlay/benchmark.md](source/records-overlay/benchmark.md) を参照する。
- 描画時間は少なくともCPUの描画投入時間と、`gl.finish()` を含むGPU完了待ちの時間を分けて報告する。前者だけをGPU描画完了時間と呼ばない。
- 性能比較の前に、同じ入力で出力の一致を確認する。画像ハッシュだけでなく、画像が空でないことも検証し、ピクセル読み出しやハッシュ計算は計測区間の外で行う。
- ベンチのシーンが合成データの場合は、本番データ、文字計測・衝突判定、IndexedDB、Google Maps投影、Worker転送、`ImageBitmap`のメインスレッド反映など、未計測の処理を明記する。合成シーンの数値を地図全体の性能として説明しない。
- 可能な限り本番と同じPixiJSバージョン、メッシュ生成器、シェーダーを再利用する。ベンチ用に処理を切り出す場合は、本番側の挙動と依存関係が変わらないことを確認する。
- Google Mapsや実ユーザーページが必要な手動計測を前提にせず、エージェントがコマンド実行と出力確認で再現できる方法を優先する。

## 検証

- `npm run build` はANTLR生成、TypeScript型チェック、ESLint、Vitest、esbuildを実行する。
- 描画ベンチを変更した場合は、`npm run benchmark:canvas` と関連テストを実行する。ベンチの意図的な比較処理やエントリーポイントは既存Lint設定との整合も確認する。
- Playwrightやブラウザーの依存を追加した際、インストール時に脆弱性監査の警告が表示されたら結果を報告し、依頼なく `npm audit fix` などで依存を一括更新しない。
