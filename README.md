# MC MOD Database（マイクラMOD検索データベース）

Modrinth と CurseForge に対応した、**完全サーバーレス** の Minecraft MOD 検索・タグ管理・モッドパック作成ツールです。  
GitHub Pages 上で静的アプリとして動作し、データはアクセスしたユーザーごとのブラウザ内（IndexedDB）および自身の非公開 GitHub Gist に保存されます。

* **公開アプリ**: https://syou11111.github.io/mc-mod-db/
* **リポジトリ**: https://github.com/syou11111/mc-mod-db

---

## 主な機能

### 1. バージョン × ローダー厳密検索 & 外部API横断検索
* **ローカルDB検索**: MCバージョン × ローダーの組み合わせ一致、採用ステータス（採用 / 候補 / 非推奨）、Client / Server 要件での絞り込みに対応。
* **外部API横断検索（Discover）**: Modrinth / CurseForge を横断検索し、チェックを入れて一括インポート可能。**「DB登録済みを除外」** トグルで未登録MODだけを効率よく探せます。
* **プラットフォーム名寄せ**: Modrinth と CurseForge の同一MODを Slug や名前から自動で統合・重複防止します。

### 2. 前提MODの自動登録・紐付け
* URL登録または検索インポート時に **「前提MOD自動登録」** が有効な場合、必須の前提MODを外部APIから自動検出してDBに登録し、`前提MOD` タグと依存関係リンクを自動作成します（最大2階層・循環参照ガード付き）。

### 3. 柔軟なタグ管理（AND / OR / NOT ＋ DAG メタタグ階層）
* サイドバーのクリックで **AND（必須）→ OR（いずれか）→ NOT（除外）** を直感的に切り替え可能。
* タグ自体に親タグ・子タグを設定できるメタタグ階層（DAG）に対応し、親タグ検索時に子タグも含めて展開検索できます。
* サイドバーから直接タグの作成・名前変更・削除が行えます。

### 4. プリセット互換シミュレータ & `.mrpack` 出力
* 複数のパーツ別プリセットを合算し、ターゲット環境（`MCバージョン × ローダー`）で動作するかを一括判定（対応済み / 代替MODあり / 非対応・前提不足）。
* **`.mrpack` エクスポート**: ブラウザ標準の `CompressionStream('deflate-raw')` を用いて、追加サーバーなしで Modrinth 互換の `.mrpack` アーカイブを直接生成・ダウンロードできます。
* Discord 共有用テキストや Markdown 表形式での出力にも対応。

### 5. ユーザーごとの保存 & GitHub Gist 自動同期
* **IndexedDB（ローカル保存）**: サーバーレスのため、アクセスした人それぞれのブラウザに独立したデータベースが作成されます。
* **JSON バックアップ / 復元**: 設定画面から全データを `.json` で書き出し・読み込み可能（APIキー等は含まれません）。
* **GitHub Gist クラウド同期（自動保存対応）**: `gist` 権限の Personal Access Token を設定すると、自分専用の非公開 Gist（`mc-mod-db-backup.json`）へ **変更の約4秒後に自動で保存（Auto-Push）** でき、別PCや別ブラウザからも復元できます。

---

## 技術構成

* **フレームワーク**: Next.js 15 (`output: 'export'` 静的エクスポート), React 19, TypeScript
* **スタイリング・アイコン**: Tailwind CSS, Lucide React
* **データ永続化**: ブラウザ IndexedDB (`mc-mod-db-v1`) ＋ `localStorage`（APIキー・トークン分離保存）
* **外部連携**: Modrinth API v2, CurseForge Core API v1, GitHub REST API (Gist)
* **ZIP / `.mrpack` 生成**: Pure Web API (`CompressionStream`, `DataView`, IEEE 802.3 CRC-32)

---

## APIキー・トークンの取り扱いについて

* **Modrinth**: APIキー不要でそのまま利用できます。
* **CurseForge**: 検索・取得を行う場合のみ、[CurseForge for Studios](https://console.curseforge.com/) で発行した Core API キー（`$2a$10$...`）を画面右上の「API・設定」から入力します。
* **GitHub Gist 同期**: 利用する場合のみ、`gist` スコープのみを付与した Personal Access Token を設定します。
* 入力された各種キー・トークンは **利用者のブラウザ内（`localStorage`）にのみ保存** され、JSON エクスポートや Gist のバックアップファイルには一切含まれません。

---

## ローカルでの開発・ビルド

```bash
npm install
npm run dev
```

静的エクスポートのビルド確認:

```bash
npm run build
```
