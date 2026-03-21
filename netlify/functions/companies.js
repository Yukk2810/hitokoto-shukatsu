// netlify/functions/companies.js
// GET  /api/companies          → 全企業リスト（軽量版）
// GET  /api/companies?id=1     → 特定企業の詳細
// GET  /api/companies?industry=半導体 → 業種フィルタ
// GET  /api/companies?q=キーエンス   → 名前・タグ検索

const { COMPANIES } = require('../../src/companies');

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=3600',
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const { id, industry, q, fields } = event.queryStringParameters || {};

  try {
    // 特定企業の詳細
    if (id) {
      const company = COMPANIES.find(c => String(c.id) === String(id));
      if (!company) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Company not found' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ data: company }) };
    }

    // フィルタ処理
    let result = [...COMPANIES];

    if (industry && industry !== 'all') {
      result = result.filter(c => c.industry === industry);
    }

    if (q) {
      const query = q.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.tagline.toLowerCase().includes(query) ||
        c.tags.some(t => t.toLowerCase().includes(query)) ||
        c.ticker.includes(query)
      );
    }

    // fieldsパラメータ: 3Dラベル表示用の軽量レスポンス
    if (fields === 'light') {
      const light = result.map(({ id, name, ticker, market, tagline, industry, emoji, domain, color }) => ({
        id, name, ticker, market, tagline, industry, emoji, domain, color
      }));
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ count: light.length, data: light }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ count: result.length, data: result }),
    };

  } catch (err) {
    console.error('companies function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};
