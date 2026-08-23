# Premiere MCP クイックスタート

これは[英語版](en.md)を元にした機械支援翻訳のドラフトです。コミュニティによる
レビューを歓迎します。現在のダウンロードリンクと対応バージョンについては
[README](../../README.md) も参照してください。

<!-- quickstart:section=before-you-start -->
## 始める前に

実案件ではなく、テスト用プロジェクトのコピーを使用してください。ローカル MCP
サーバー、Premiere コネクター、AI クライアントは同じコンピューターで動作している
必要があります。まず読み取り専用の接続確認を行います。インストール済みであること
やパネルが緑色であることは、ライセンス済み Premiere ホストで編集が成功した証明には
なりません。

<!-- quickstart:section=install -->
## サーバーとコネクターをインストールする

Claude Desktop では、現在の GitHub リリースから `.mcpb` バンドルと、別配布の署名済み
Premiere コネクターをインストールしてください。両方のアプリを再起動します。

他の MCP クライアントでは、サーバーの後に CEP コネクターをインストールします。

```bash
npm install -g premiere-pro-mcp
premiere-pro-mcp --install-cep
```

クライアントには `premiere-pro-mcp` を実行するよう設定します。クライアント別の JSON
例は完全版 README にあります。

<!-- quickstart:section=prove-connection -->
## 安全に接続を確認する

1. Premiere を開き、コピーしたテストプロジェクトとアクティブなシーケンスを開きます。
2. Premiere で **Window > Extensions > MCP for Adobe Premiere Pro** を選びます。
   “Running” はパネルブリッジが利用可能であることを示すだけで、編集完了の主張では
   ありません。
3. ローカルの事前確認を実行します。

   ```bash
   premiere-pro-mcp --doctor
   ```

4. AI クライアントに次のよう依頼します: `Run verify_premiere_connection. Make no changes.`

ローカル doctor はパッケージと設定の検出結果を報告します。MCP の応答は、プロジェクト
詳細を返さずに、選択したブリッジ、プロジェクト、シーケンスの準備状態を報告します。
失敗やシーケンス未選択は設定を修正すべき結果であり、変更操作を再試行する許可では
ありません。

<!-- quickstart:section=first-edit -->
## 最初の編集は慎重に行う

読み取り専用チェックが成功した後、コピーしたテストシーケンスを対象とする限定的な
計画を依頼します。編集を許可する前に、対象、変更内容、確認境界を確認してください。
その後シーケンスを再確認し、Undo でフィクスチャが元の状態に戻ることを確認します。

<!-- quickstart:section=remove -->
## コネクターを削除する

最初に Premiere を完全に終了してから、この CEP コネクターだけを削除します。

```bash
premiere-pro-mcp --uninstall-cep
```

他の CEP 拡張機能を妨げないよう、Adobe の共有デバッグ設定は変更しません。不要になった
場合は、AI クライアントの設定から MCP サーバーを削除し、npm パッケージも別途
アンインストールしてください。
