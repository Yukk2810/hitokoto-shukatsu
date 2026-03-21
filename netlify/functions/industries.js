// netlify/functions/industries.js
// GET /api/industries → 業種一覧と件数

const { COMPANIES } = require('../../src/companies');

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=86400',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const counts = {};
  COMPANIES.forEach(c => {
    counts[c.industry] = (counts[c.industry] || 0) + 1;
  });

  const industries = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      total: COMPANIES.length,
      industries,
    }),
  };
};
