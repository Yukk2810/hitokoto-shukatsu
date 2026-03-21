# ひとこと就活 — 企業との出会い系

企業のキャッチコピーが3D空間に浮遊し、直感的に企業と出会えるWebアプリ。

## プロジェクト構成

```
hitokoto-shukatsu/
├── netlify.toml              # Netlify設定
├── package.json
├── src/
│   └── companies.js          # 企業データ（バックエンドと共有）
├── netlify/
│   └── functions/
│       ├── companies.js      # GET /api/companies
│       └── industries.js     # GET /api/industries
└── public/                   # 静的ファイル（Netlifyがホスト）
    ├── index.html            # メインアプリ
    ├── _redirects            # URLルーティング
    └── assets/
        └── logo.png
```

## Netlifyへのデプロイ手順

### 1. GitHubリポジトリを作成してプッシュ

```bash
cd hitokoto-shukatsu
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/hitokoto-shukatsu.git
git push -u origin main
```

### 2. Netlifyにサイトを作成

1. https://app.netlify.com にアクセス
2. "Add new site" → "Import an existing project"
3. GitHubを選択してリポジトリを選ぶ
4. ビルド設定:
   - **Build command**: （空欄のまま）
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`（自動検出）
5. "Deploy site" をクリック

### 3. netlify.toml があれば設定は自動適用される

---

## APIエンドポイント（Netlify Functions）

| Endpoint | 説明 |
|---|---|
| `GET /api/companies` | 全企業一覧（60社） |
| `GET /api/companies?id=1` | 特定企業の詳細 |
| `GET /api/companies?industry=半導体` | 業種フィルタ |
| `GET /api/companies?q=キーエンス` | 名前・タグ検索 |
| `GET /api/companies?fields=light` | 3Dラベル用軽量版 |
| `GET /api/industries` | 業種一覧と件数 |

## ローカル開発

```bash
npm install
npx netlify dev
# → http://localhost:8888 で起動
```

## 企業データの追加・編集

`src/companies.js` の `COMPANIES` 配列に追記するだけ。
フロントエンドはAPIからデータを取得するため、再デプロイで反映される。
