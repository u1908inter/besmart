# BeSmart — スマホで遊べるBMSプレイヤー

BMS／bmson 形式の譜面を、スマートフォンのブラウザでそのまま遊べるリズムゲームです。インストールも登録も要りません。

- **遊ぶ**：https://u1908inter.github.io/besmart/
- **機能と仕様の詳しい説明**：https://u1908inter.github.io/besmart/about.html

## 曲の入れ方

1. **ファイルから**：曲一覧の「追加」から、BMSの書庫（ZIP・RAR・LZH・7z）か、BMS／bmsonと音声ファイルをまとめて選びます。書庫の中の書庫も自動で展開します。
2. **URLから**：「URLから追加」に配布元のダウンロードURLを貼ります。

### URLから追加について

ブラウザの仕組み（CORS）上、他サイトからの読み込みを許可している配布元にしか対応できません。

| 配布元 | 対応 |
|---|---|
| GitHub のリポジトリ内のファイル（`github.com/…/blob/…` は自動で raw に変換） | ○ |
| Dropbox の共有リンク（自動で直接ダウンロード用に変換） | ○（予定。実機で要確認） |
| `Access-Control-Allow-Origin` を返す個人サイト・サーバー | ○ |
| GitHub のリリース添付ファイル | × |
| Google ドライブ・MEGA・OneDrive・MediaFire・BOOTH など | × |

×の配布元は、スマホでファイルをダウンロードしてから「追加」で選んでください。

### 配布者の方へ：ワンタップで読み込めるリンク

`?url=` に配布URLを付けたリンクを開くと、そのURLが入力された状態で「URLから追加」が開きます（読み込むかどうかは利用者が確認してから決めます）。

```
https://u1908inter.github.io/besmart/?url=https%3A%2F%2Fexample.com%2Fsong.zip
```

自分のサーバーで配布する場合は、レスポンスに `Access-Control-Allow-Origin: *`（または `https://u1908inter.github.io`）を付けてください。

## プライバシー

曲・スコア・リプレイ・設定は、端末のブラウザ内（IndexedDB／localStorage）だけに保存されます。アップロードやアクセス解析は行いません。「URLから追加」を使ったときだけ、入力した配布元からファイルをダウンロードします。

BeSmart にはコードで作ったオリジナルのデモ曲とチュートリアル以外の楽曲は含まれていません。読み込む曲は、各楽曲の配布条件に従って使ってください。BeSmart は個人による非商用のプレイヤーで、特定のゲーム会社や他のBMSプレイヤーとは関係がありません。

## 構成

ビルド不要の静的サイトです。GitHub Pages（ブランチ `main`、フォルダ `/`）でそのまま公開できます。

| ファイル | 内容 |
|---|---|
| `index.html` | アプリ本体（HTML・CSS・JavaScript・フォントを1ファイルに同梱） |
| `about.html` | 紹介ページ |
| `unrar.js` / `unrar.wasm` | RAR の展開（node-unrar-js） |
| `la/` | 7z の展開（libarchive.js） |
| `vendor/ogg-vorbis-decoder.min.js` | OGG の再生（端末が対応していない場合） |
| `licenses/` | 同梱ソフトウェアとフォントのライセンス |

## 同梱しているソフトウェアとフォント

- node-unrar-js（MIT）／ UnRAR — UnRAR ライセンス（`licenses/unrar_license.txt`）
- libarchive.js（MIT）／ libarchive — BSD-2-Clause（`licenses/libarchive_COPYING.txt`）
- wasm-audio-decoders / ogg-vorbis（MIT）／ libogg・libvorbis — BSD-3-Clause（`licenses/libogg_COPYING.txt`, `licenses/libvorbis_COPYING.txt`）
- DotGothic16 / Dela Gothic One — SIL Open Font License 1.1（`licenses/*_OFL.txt`）

アプリ内の「設定」→「このアプリについて・ライセンス」にも全文を掲載しています。
