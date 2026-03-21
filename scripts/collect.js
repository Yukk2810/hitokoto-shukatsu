/**
 * collect.js
 * JPX公開RSSから適時開示情報を取得し、
 * public/data/disclosures/ 以下にJSONとして書き出す
 *
 * フェーズ1: 食品セクター対象（段階的に拡大予定）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import fetch from 'node-fetch';

// ─── 設定 ───────────────────────────────────────────
const DRY_RUN      = process.argv.includes('--dry-run');
const FORCE_FULL   = process.env.FORCE_FULL === 'true';

// JPX 適時開示情報閲覧サービス RSS
// 公開されているRSSフィード（全市場・全種別）
const JPX_RSS_URL  = 'https://www.release.tdnet.info/inbs/I_list_001_ja.html';
// ※ TDnetはRSS形式での公式公開がないため、公開閲覧ページを解析する
// フォールバック: JPX全体RSS（存在する場合）
const JPX_FEED_URLS = [
  // JPXが公式に提供しているRSSフィード（2024年時点）
  'https://www.jpx.co.jp/news/1024/index.xml',
  // Yahooファイナンスの適時開示RSS（代替ソース）
  'https://finance.yahoo.co.jp/rss/1024.xml',
];

// ひとこと就活の対象銘柄コード（食品セクター + 登録企業）
// 初期フェーズは食品・消費財中心に絞る
const TARGET_CODES = new Set([
  // 食品・消費財
  '2802', // 味の素
  '2801', // キッコーマン
  '2503', // キリンHD
  '2587', // サントリー食品
  '2269', // 明治HD
  '2201', // 森永製菓
  '2206', // 江崎グリコ
  '2111', // 精糖工業会
  '4452', // 花王（登録済み）
  // 登録企業（全60社の証券コード）
  '7203','6758','9613','6098','7974','9983','8306','4755','6902','4751',
  '9984','6501','9843','4661','5201','4385','8053','6752','5802','6701',
  '6622','9502','9532','8002','9412','3593','5393','186A','6367','8136',
  '9501','5801','5631','4461','7011','3110','285A','6330','6302','5713',
  '5706','6702','6744','8035','7735','6146','6857','6920','6861','6954',
  '6273','6481','6981','6762','6963','6971','6594','7012','7013',
]);

// 開示カテゴリの正規化マッピング
const CATEGORY_MAP = {
  '決算短信': '決算',
  '四半期報告書': '決算',
  '業績予想の修正': '業績修正',
  '業績予想修正': '業績修正',
  '自己株式': '自己株',
  '配当': '配当',
  '株主総会': '招集通知',
  '招集通知': '招集通知',
  '合併': 'M&A',
  '買収': 'M&A',
  '子会社': '子会社',
  '役員': '役員人事',
  '人事': '役員人事',
  'IR': 'IR資料',
};

// 重要度マッピング
const IMPORTANCE_RULES = [
  { keywords: ['決算短信', '業績予想の修正', '業績予想修正', '業績修正', '合併', '買収', 'TOB', '上場廃止'], level: 'high' },
  { keywords: ['配当', '自己株式', '株主総会', '招集通知', '四半期'], level: 'medium' },
];

// ─── ユーティリティ ───────────────────────────────────
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function makeId(item) {
  // PDF URL が一番安定した一意キー
  if (item.pdfUrl) return createHash('md5').update(item.pdfUrl).digest('hex').slice(0, 12);
  // フォールバック: コード + 日時 + タイトル の先頭64文字
  const raw = `${item.code}|${item.publishedAt}|${(item.title || '').slice(0, 64)}`;
  return createHash('md5').update(raw).digest('hex').slice(0, 12);
}

function normalizeCategory(title) {
  for (const [key, cat] of Object.entries(CATEGORY_MAP)) {
    if (title.includes(key)) return cat;
  }
  return 'その他';
}

function calcImportance(title, category) {
  for (const rule of IMPORTANCE_RULES) {
    if (rule.keywords.some(k => title.includes(k) || category.includes(k))) return rule.level;
  }
  return 'low';
}

function resolveDataPath(...parts) {
  // スクリプトは scripts/ にあり、public/ は1階層上
  return path.join(process.cwd(), '..', 'public', 'data', 'disclosures', ...parts);
}

function readJsonSafe(filePath, fallback = {}) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  if (DRY_RUN) { log(`[DRY-RUN] would write: ${filePath}`); return; }
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── RSS取得・パース ──────────────────────────────────
async function fetchRss(url) {
  log(`RSS取得: ${url}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'hitokoto-shukatsu-collector/1.0 (https://github.com/your-repo)' },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timeout);
    log(`取得失敗: ${url} — ${err.message}`);
    return null;
  }
}

function parseRssItems(xmlText) {
  if (!xmlText) return [];
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const obj = parser.parse(xmlText);
    const channel = obj?.rss?.channel || obj?.feed || {};
    const items = channel.item || channel.entry || [];
    return Array.isArray(items) ? items : [items];
  } catch (err) {
    log(`RSSパースエラー: ${err.message}`);
    return [];
  }
}

// RSSアイテムを正規化された開示オブジェクトに変換
function normalizeItem(raw) {
  // 証券コードの抽出（タイトルや説明文から）
  const codeMatch = (raw.title || raw.description || '').match(/\b(\d{4})\b/);
  const code = codeMatch?.[1] || null;

  // 日時の正規化
  const rawDate = raw.pubDate || raw.published || raw.updated || null;
  let publishedAt = null;
  if (rawDate) {
    try { publishedAt = new Date(rawDate).toISOString(); } catch (_) {}
  }

  // PDF URLの抽出
  const link = raw.link?.['#text'] || raw.link || raw.guid?.['#text'] || raw.guid || null;
  const pdfUrl = (typeof link === 'string' && link.includes('.pdf')) ? link : null;

  const title = (raw.title || '').trim();
  const category = normalizeCategory(title);
  const importance = calcImportance(title, category);

  return {
    id: null, // makeIdで後付け
    code,
    company: raw['dc:subject'] || raw.author?.name || null,
    publishedAt,
    title,
    category,
    importance,
    pdfUrl,
    sourceUrl: pdfUrl || (typeof link === 'string' ? link : null),
    source: 'JPX TDnet public',
    fetchedAt: new Date().toISOString(),
  };
}

// ─── メイン処理 ───────────────────────────────────────
async function main() {
  log('=== ひとこと就活 開示収集 開始 ===');

  // 既存データ読み込み
  const latestPath  = resolveDataPath('latest.json');
  const summaryPath = resolveDataPath('summary.json');

  const existing = readJsonSafe(latestPath, { disclosures: [] });
  const existingIds = new Set((existing.disclosures || []).map(d => d.id).filter(Boolean));

  let newItems = [];
  let errorCount = 0;

  // 各RSSフィードから取得
  for (const url of JPX_FEED_URLS) {
    const xml = await fetchRss(url);
    if (!xml) { errorCount++; continue; }

    const rawItems = parseRssItems(xml);
    log(`取得: ${rawItems.length}件 from ${url}`);

    for (const raw of rawItems) {
      const item = normalizeItem(raw);

      // 対象銘柄フィルタ（空のコードは除外）
      if (!item.code || (!TARGET_CODES.has(item.code) && item.code)) continue;

      item.id = makeId(item);

      // 差分チェック（強制フルの場合はスキップ）
      if (!FORCE_FULL && existingIds.has(item.id)) continue;

      newItems.push(item);
    }
  }

  log(`新規: ${newItems.length}件, エラー: ${errorCount}件`);

  if (newItems.length === 0 && !FORCE_FULL) {
    log('新規開示なし — 終了');
    // summaryだけ更新
    writeJson(summaryPath, {
      updatedAt: new Date().toISOString(),
      total: (existing.disclosures || []).length,
      newCount: 0,
      errors: errorCount,
    });
    return;
  }

  // マージ（新規を先頭に）
  const allDisclosures = FORCE_FULL
    ? newItems
    : [...newItems, ...(existing.disclosures || [])];

  // 最大保持件数: 1000件
  const limited = allDisclosures.slice(0, 1000);

  // latest.json 更新
  writeJson(latestPath, {
    updatedAt: new Date().toISOString(),
    count: limited.length,
    disclosures: limited,
  });

  // 企業別JSON更新
  const byCode = {};
  for (const d of limited) {
    if (!d.code) continue;
    if (!byCode[d.code]) byCode[d.code] = [];
    byCode[d.code].push(d);
  }

  for (const [code, items] of Object.entries(byCode)) {
    const codePath = resolveDataPath('by-code', `${code}.json`);
    writeJson(codePath, {
      code,
      updatedAt: new Date().toISOString(),
      count: items.length,
      disclosures: items.slice(0, 50), // 企業別は最大50件
    });
    log(`  ${code}: ${items.length}件`);
  }

  // summary.json 更新
  writeJson(summaryPath, {
    updatedAt: new Date().toISOString(),
    total: limited.length,
    newCount: newItems.length,
    byImportance: {
      high:   limited.filter(d => d.importance === 'high').length,
      medium: limited.filter(d => d.importance === 'medium').length,
      low:    limited.filter(d => d.importance === 'low').length,
    },
    errors: errorCount,
  });

  log('=== 収集完了 ===');
}

main().catch(err => {
  console.error('収集エラー:', err);
  process.exit(1);
});
