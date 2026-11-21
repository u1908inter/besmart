// BeSmart「まとめて追加」用の個人中継（Cloudflare Worker）
// 配布元が他サイトからの読み込みを許可していないときに、ファイルを取ってきて BeSmart に渡します。
// Googleドライブ・OneDrive・MediaFire・BOFの作品ページなどは、ページをたどって書庫そのものを探します。
// 使えるのは BeSmart のページ（ALLOW）から、合言葉（環境変数 KEY）を知っている人だけです。
const ALLOW = ['https://u1908inter.github.io'];
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36';
const ARCH = /\.(zip|rar|7z|lzh|lha)(\?|#|$)/i;
const FILE_HOSTS = /(^|\.)(drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com|dropbox\.com|dropboxusercontent\.com|onedrive\.live\.com|skydrive\.live\.com|1drv\.ms|mediafire\.com|github\.com|githubusercontent\.com|bmsdrive\.zris\.work)$/i;
const SKIP_HOSTS = /(^|\.)(twitter\.com|x\.com|youtube\.com|youtu\.be|nicovideo\.jp|nico\.ms|soundcloud\.com|pixiv\.net|facebook\.com|instagram\.com|bandcamp\.com|google\.com|mega\.nz|mega\.co\.nz|booth\.pm)$/i;

class Fail extends Error {}

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
    const text = (s, status) => new Response(s, { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET' || !ALLOW.includes(origin)) return new Response('forbidden', { status: 403 });
    if (!env.KEY || req.headers.get('X-Key') !== env.KEY) return text('合言葉が違います', 401);

    const q = new URL(req.url).searchParams;
    if (q.has('ping')) return text('ok', 200);
    let target;
    try { target = new URL(q.get('url') || ''); } catch (e) { return text('URLの形式が正しくありません', 400); }
    if (!/^https?:$/.test(target.protocol)) return text('URLの形式が正しくありません', 400);

    try {
      const r = await resolve(target, 0, new Set());
      const h = new Headers(cors);
      for (const k of ['Content-Type', 'Content-Length', 'Content-Disposition']) { const v = r.headers.get(k); if (v) h.set(k, v); }
      h.set('X-Final-Url', r.url);
      return new Response(r.body, { status: 200, headers: h });
    } catch (e) {
      return text(e instanceof Fail ? e.message : '取得できませんでした（' + (e && e.message || e) + '）', 422);
    }
  },
};

/* ---------- resolving a share or download page to the file itself ---------- */
async function resolve(u, depth, seen) {
  if (depth > 3) throw new Fail('ダウンロードページをたどりきれませんでした');
  if (seen.has(u.href)) throw new Fail('ダウンロードページをたどりきれませんでした');
  seen.add(u.href);
  const h = u.hostname.toLowerCase();

  if (/(^|\.)mega\.(nz|co\.nz)$/.test(h)) throw new Fail('MEGAは暗号化されているため取得できません');

  // Google Drive / Docs
  if (/^(drive|docs)\.google\.com$/.test(h) || h === 'drive.usercontent.google.com') {
    if (/\/folders\//.test(u.pathname) || /\/drive\/.*folder/.test(u.pathname)) throw new Fail('Googleドライブのフォルダ共有は取得できません');
    const id = (u.pathname.match(/\/(?:file\/)?d\/([\w-]{10,})/) || [])[1] || u.searchParams.get('id');
    if (!id) throw new Fail('GoogleドライブのファイルIDが見つかりません');
    return driveGet(id);
  }

  // OneDrive (old SkyDrive links too)
  if (/(^|\.)(onedrive\.live\.com|skydrive\.live\.com|1drv\.ms)$/.test(h)) {
    if (/^\/f\//.test(u.pathname)) throw new Fail('OneDriveのフォルダ共有は取得できません');
    const share = 'u!' + btoa(u.href).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    const r = await get(`https://api.onedrive.com/v1.0/shares/${share}/root/content`);
    if (r.ok && !isHtml(r)) return r;
    throw new Fail('OneDriveから取得できませんでした（非公開・フォルダ・削除済みの可能性）');
  }

  // MediaFire: the page carries the real link
  if (/(^|\.)mediafire\.com$/.test(h) && !/^download\d*\./.test(h)) {
    const r = await get(u.href);
    if (!r.ok) throw new Fail(`MediaFire：HTTP ${r.status}`);
    if (!isHtml(r)) return r;
    const html = await r.text();
    let link = (html.match(/href="(https?:\/\/download\d*\.mediafire\.com\/[^"]+)"/i) || [])[1];
    if (!link) { const s = (html.match(/data-scrambled-url="([^"]+)"/i) || [])[1]; if (s) { try { link = atob(s); } catch (e) {} } }
    if (!link) throw new Fail('MediaFireのダウンロードリンクが見つかりません（削除済みの可能性）');
    return resolve(new URL(unent(link)), depth + 1, seen);
  }

  // Dropbox share links → direct
  if (/(^|\.)dropbox\.com$/.test(h)) {
    const x = new URL(u.href); x.hostname = 'dl.dropboxusercontent.com'; ['dl', 'raw', 'st'].forEach(k => x.searchParams.delete(k));
    u = x;
  }

  // anything else: take the file, or look for one on the page
  const r = await get(u.href);
  if (!r.ok) throw new Fail(`HTTP ${r.status}（${u.hostname}）`);
  if (!isHtml(r)) return r;
  // a link to a file that answers with a page is dead: do not pick some other song off that page
  if (ARCH.test(u.pathname)) throw new Fail('ファイルではなくWebページが返ってきました（リンク切れの可能性）');
  const html = await r.text();
  const cands = pickLinks(html, new URL(r.url || u.href));
  if (!cands.length) throw new Fail(`${u.hostname} のページにダウンロードリンクが見つかりません`);
  let last = null;
  for (const c of cands.slice(0, 4)) {
    try { return await resolve(c, depth + 1, seen); } catch (e) { last = e; }
  }
  throw last || new Fail('ダウンロードリンクをたどれませんでした');
}

async function driveGet(id) {
  let r = await get(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`);
  if (r.ok && !isHtml(r)) return r;
  if (r.ok) {
    // "can't scan for viruses" or similar confirmation form: submit it
    const html = await r.text();
    const form = html.match(/<form[^>]+id="download-form"[^>]*action="([^"]+)"[\s\S]*?<\/form>/i);
    if (form) {
      const act = new URL(unent(form[1]), 'https://drive.usercontent.google.com/');
      for (const m of form[0].matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
        const n = (m[0].match(/name="([^"]+)"/) || [])[1], v = (m[0].match(/value="([^"]*)"/) || [])[1];
        if (n) act.searchParams.set(n, unent(v || ''));
      }
      r = await get(act.href);
      if (r.ok && !isHtml(r)) return r;
    }
  }
  throw new Fail('Googleドライブから取得できませんでした（非公開・削除済み・ダウンロード上限の可能性）');
}

function pickLinks(html, base) {
  const out = [], seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let x; try { x = new URL(unent(m[1]).trim(), base); } catch (e) { continue; }
    if (!/^https?:$/.test(x.protocol) || seen.has(x.href)) continue;
    const h = x.hostname.toLowerCase();
    if (SKIP_HOSTS.test(h) && !/^(drive|docs)\.google\.com$/.test(h)) continue;
    const label = m[2].replace(/<[^>]+>/g, '');
    let s = 0;
    if (ARCH.test(x.pathname)) s = 3;
    else if (FILE_HOSTS.test(h)) s = 2;
    else if (/download|ダウンロード|\bdl\b|本体/i.test(x.pathname + x.search + ' ' + label)) s = 1;
    if (!s) continue;
    if (/差分|sabun|diff/i.test(label)) s = 0.5; // on an entry page, the song before the add-on charts
    seen.add(x.href); out.push([s, out.length, x]);
  }
  return out.sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(a => a[2]);
}

function get(url) { return fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': '*/*' } }); }
function isHtml(r) { return /text\/html|application\/xhtml/i.test(r.headers.get('Content-Type') || ''); }
function unent(s) { return String(s).replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
