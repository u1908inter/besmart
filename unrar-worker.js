/* BeSmart: RAR extraction for very large archives.
   Reads the archive straight from the File in small pieces (FileReaderSync), so multi-GB packs
   never have to fit in memory. Protocol:
     {cmd:'list', file}            -> {type:'list', heads:[{name,size,dir,enc}]}
     {cmd:'extract', names:[...]}  -> {type:'file', name, buf} ... (waits for {cmd:'ack'} after each)
                                      {type:'progress', pos, size}
                                      {type:'done', failed:[names]}
     errors                        -> {type:'error', message}                                      */
self.window = self;
importScripts('unrar.js');

class BlobFile {
  constructor(blob) { this.b = blob; this.size = blob.size; this.pos = 0; this.fr = new FileReaderSync(); this.cs = -1; this.cb = null; }
  fill(at) { // 4 MB read-ahead window
    const end = Math.min(this.size, at + 4 * 1024 * 1024);
    this.cb = new Uint8Array(this.fr.readAsArrayBuffer(this.b.slice(at, end)));
    this.cs = at;
  }
  read(n) {
    if (this.pos + n > this.size) return null;
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      const p = this.pos + o;
      if (!this.cb || p < this.cs || p >= this.cs + this.cb.length) this.fill(p);
      const off = p - this.cs, take = Math.min(n - o, this.cb.length - off);
      out.set(this.cb.subarray(off, off + take), o);
      o += take;
    }
    this.pos += n;
    return out;
  }
  readAll() { return this.read(this.size - this.pos) || new Uint8Array(); }
  write() { return false; }
  tell() { return this.pos; }
  seek(l, how) {
    let h = this.pos;
    h = how === 'SET' ? l : how === 'CUR' ? h + l : this.size - l;
    if (h < 0 || h > this.size) return false;
    this.pos = h;
    return true;
  }
}

let wasm = null, file = null, src = null, ackResolve = null;
async function open() {
  if (!wasm) { const r = await fetch('unrar.wasm'); if (!r.ok) throw new Error('RAR展開モジュールを読み込めませんでした'); wasm = await r.arrayBuffer(); }
  src = new BlobFile(file);
  return await self.UnrarLib.createExtractorFromData({ wasmBinary: wasm.slice(0), data: { __blobFile: src } });
}
const why = e => (e && (e.reason || e.message)) || String(e);

self.onmessage = async ev => {
  const m = ev.data;
  if (m.cmd === 'ack') { const r = ackResolve; ackResolve = null; if (r) r(); return; }
  try {
    if (m.cmd === 'list') {
      file = m.file;
      const ex = await open();
      const heads = [...ex.getFileList().fileHeaders].map(h => ({ name: h.name, size: h.unpSize, dir: !!(h.flags && h.flags.directory), enc: !!(h.flags && h.flags.encrypted) }));
      self.postMessage({ type: 'list', heads });
    } else if (m.cmd === 'extract') {
      const want = new Set(m.names), done = new Set(), failed = [];
      // A file that stops extraction (broken entry, symlink, …) is skipped and extraction restarts after it.
      for (let attempt = 0; attempt < 50; attempt++) {
        const ex = await open();
        let last = 0;
        try {
          const { files } = ex.extract({ files: h => want.has(h.name) && !done.has(h.name) && !failed.includes(h.name) });
          for (const f of files) {
            const name = f.fileHeader.name;
            done.add(name);
            if (f.extraction) {
              const buf = f.extraction.slice().buffer;
              const wait = new Promise(r => { ackResolve = r; });
              self.postMessage({ type: 'file', name, buf }, [buf]);
              await wait;
            }
            const now = Date.now();
            if (now - last > 400) { last = now; self.postMessage({ type: 'progress', pos: src.pos, size: src.size }); }
          }
          break;
        } catch (e) {
          if (/password|crc/i.test(why(e))) throw new Error('パスワード付き、または壊れたRARのようです');
          const bad = m.names.find(n => !done.has(n) && !failed.includes(n));
          if (!bad) break;
          failed.push(bad);
        }
      }
      self.postMessage({ type: 'done', failed });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: why(e) });
  }
};
