// BeSmart「まとめて追加」用の個人中継（Cloudflare Worker）
// 配布元が他サイトからの読み込みを許可していないときに、ファイルを取ってきて BeSmart に渡します。
// 使えるのは BeSmart のページ（ALLOW）から、合言葉（環境変数 KEY）を知っている人だけです。
const ALLOW = ['https://u1908inter.github.io'];

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOW.includes(origin) ? origin : ALLOW[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Key',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Type, Content-Disposition, X-Final-Url',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET' || !ALLOW.includes(origin)) return new Response('forbidden', { status: 403 });
    if (!env.KEY || req.headers.get('X-Key') !== env.KEY) return new Response('bad key', { status: 401, headers: cors });

    const q = new URL(req.url).searchParams;
    if (q.has('ping')) return new Response('ok', { headers: cors });
    let target;
    try { target = new URL(q.get('url') || ''); } catch (e) { return new Response('bad url', { status: 400, headers: cors }); }
    if (!/^https?:$/.test(target.protocol)) return new Response('bad url', { status: 400, headers: cors });

    let r;
    try {
      r = await fetch(target.href, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (BeSmart personal downloader)' } });
    } catch (e) {
      return new Response('upstream error', { status: 502, headers: cors });
    }
    const h = new Headers(cors);
    for (const k of ['Content-Type', 'Content-Length', 'Content-Disposition']) { const v = r.headers.get(k); if (v) h.set(k, v); }
    h.set('X-Final-Url', r.url);
    return new Response(r.body, { status: r.status, headers: h });
  },
};
