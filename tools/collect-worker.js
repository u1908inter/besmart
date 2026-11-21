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
      'Access-Control-Expose-Headers': 'Content-Length, Content-Type, Content-Disposition, X-Final-Url, X-Collect-Error',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const bg = new URL(req.url).searchParams.has('k');
    // background downloads stall on an error status, so they get 200 with an X-Collect-Error header instead
    const text = (s, status) => new Response(s, { status: bg && status !== 200 ? 200 : status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', ...(status !== 200 ? { 'X-Collect-Error': String(status) } : {}) } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // a page from another site is refused; requests with no Origin (background downloads) still need the key
    if (req.method !== 'GET' || (origin && !ALLOW.includes(origin))) return new Response('forbidden', { status: 403 });
    const q = new URL(req.url).searchParams;
    // the key comes as a header, or as ?k= for background downloads (those cannot send custom headers)
    if (!env.KEY || (req.headers.get('X-Key') || q.get('k')) !== env.KEY) return text('合言葉が違います', 401);
    if (q.has('ping')) return text('ok', 200);
    let target;
    try { target = new URL(q.get('url') || ''); } catch (e) { return text('URLの形式が正しくありません', 400); }
    if (!/^https?:$/.test(target.protocol)) return text('URLの形式が正しくありません', 400);

    try {
      let r;
      try { r = await resolve(target, 0, new Set()); }
      catch (e) {
        // a dead link to a file: try the Internet Archive's copy
        if (!(e instanceof Fail) || !ARCH.test(target.pathname) || /(^|\.)archive\.org$/.test(target.hostname)) throw e;
        r = await wayback(target).catch(() => null);
        if (!r) throw new Fail(e.message + '（Internet Archiveにも保存されていませんでした）');
      }
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
    if (r.ok && !isHtml(r)) return checkArchive(r);
    throw new Fail('OneDriveから取得できませんでした（非公開・フォルダ・削除済みの可能性）');
  }

  // MediaFire: the page carries the real link
  if (/(^|\.)mediafire\.com$/.test(h) && !/^download\d*\./.test(h)) {
    const r = await get(u.href);
    if (!r.ok) throw new Fail(`MediaFire：HTTP ${r.status}`);
    if (!isHtml(r)) return checkArchive(r);
    const html = await pageText(r);
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
  if (!isHtml(r)) return checkArchive(r);
  // a link to a file that answers with a page is dead: do not pick some other song off that page
  if (ARCH.test(u.pathname)) throw new Fail('ファイルではなくWebページが返ってきました（リンク切れの可能性）');
  const html = await pageText(r);
  const cands = pickLinks(html, new URL(r.url || u.href));
  if (!cands.length) throw new Fail(`${u.hostname} のページにダウンロードリンクが見つかりません`);
  let last = null;
  for (const c of cands.slice(0, 4)) {
    try { return await resolve(c, depth + 1, seen); } catch (e) { last = e; }
  }
  throw last || new Fail('ダウンロードリンクをたどれませんでした');
}

// the response must really be an archive: look at its first bytes, then hand the whole body on
async function checkArchive(r) {
  const rd = r.body.getReader(); let head = new Uint8Array(0);
  while (head.length < 8) {
    const { done, value } = await rd.read(); if (done) break;
    const n = new Uint8Array(head.length + value.length); n.set(head); n.set(value, head.length); head = n;
  }
  const u = head;
  const ok = (u[0] === 0x50 && u[1] === 0x4B) || (u[0] === 0x52 && u[1] === 0x61 && u[2] === 0x72 && u[3] === 0x21) ||
    (u[0] === 0x37 && u[1] === 0x7A && u[2] === 0xBC && u[3] === 0xAF) || (u[2] === 0x2D && u[3] === 0x6C && (u[4] === 0x68 || u[4] === 0x7A) && u[6] === 0x2D);
  if (!ok) {
    try { rd.cancel(); } catch (e) {}
    let host = ''; try { host = new URL(r.url).hostname; } catch (e) {}
    throw new Fail(`書庫ではないファイルが返ってきました（${host}・${r.headers.get('Content-Type') || '種類不明'}・${head.length < 8 ? '空に近い' : '中身が違う'}）`);
  }
  const body = new ReadableStream({
    start(c) { c.enqueue(head); },
    // a server that stops sending halfway would hold a background download forever: cut it after 60 s of silence
    async pull(c) {
      let t;
      const idle = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('stalled')), 60000); });
      try {
        const { done, value } = await Promise.race([rd.read(), idle]);
        if (done) c.close(); else c.enqueue(value);
      } catch (e) { try { rd.cancel(); } catch (x) {} c.error(e); }
      finally { clearTimeout(t); }
    },
    cancel() { try { rd.cancel(); } catch (e) {} },
  });
  return { headers: r.headers, url: r.url, body };
}

async function wayback(u) {
  const a = await get('https://archive.org/wayback/available?url=' + encodeURIComponent(u.href));
  if (!a.ok) return null;
  const snap = ((await a.json()).archived_snapshots || {}).closest;
  if (!snap || !snap.available || String(snap.status) !== '200') return null;
  const raw = snap.url.replace(/^http:/, 'https:').replace(/\/web\/(\d+)\//, '/web/$1id_/');
  const r = await get(raw);
  if (!r.ok || isHtml(r)) return null;
  return checkArchive(r);
}

async function driveGet(id) {
  let r = await get(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`);
  if (r.ok && !isHtml(r)) return checkArchive(r);
  if (r.ok) {
    // "can't scan for viruses" or similar confirmation form: submit it
    const html = await pageText(r);
    const form = html.match(/<form[^>]+id="download-form"[^>]*action="([^"]+)"[\s\S]*?<\/form>/i);
    if (form) {
      const act = new URL(unent(form[1]), 'https://drive.usercontent.google.com/');
      for (const m of form[0].matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
        const n = (m[0].match(/name="([^"]+)"/) || [])[1], v = (m[0].match(/value="([^"]*)"/) || [])[1];
        if (n) act.searchParams.set(n, unent(v || ''));
      }
      r = await get(act.href);
      if (r.ok && !isHtml(r)) return checkArchive(r);
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

// a server that never answers would hold a background download at 99% forever: give up on the headers after 40 s
function get(url) {
  return Promise.race([
    fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': '*/*' } })
      .catch(() => { let h = url; try { h = new URL(url).hostname; } catch (e) {} throw new Fail(`配布元に接続できません（${h}）`); }),
    new Promise((_, rej) => setTimeout(() => rej(new Fail('配布元が応答しません（40秒）')), 40000)),
  ]);
}
// only the start of a page is read, which keeps link hunting inside the free plan's CPU limit
async function pageText(r, max = 400000) {
  const rd = r.body.getReader(), dec = new TextDecoder(); let s = '';
  while (s.length < max) { const { done, value } = await rd.read(); if (done) break; s += dec.decode(value, { stream: true }); }
  try { rd.cancel(); } catch (e) {}
  return s;
}
function isHtml(r) { return /text\/html|application\/xhtml/i.test(r.headers.get('Content-Type') || ''); }
function unent(s) { return String(s).replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
