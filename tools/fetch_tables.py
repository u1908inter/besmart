#!/usr/bin/env python3
"""Mirror popular BMS difficulty tables into tables/<id>/ so BeSmart can read them.

Most table sites do not allow reading from other web pages, so the app cannot load
them directly. This script (run daily by GitHub Actions) downloads each table's
header and data JSON and saves them next to the app. A table that fails to download
keeps its previous copy.
"""
import json, os, re, sys, time, urllib.request, urllib.parse

TABLES = [
    # id, page URL (alternatives after "|")
    ("normal1", "https://darksabun.github.io/table/archive/normal1/|https://darksabun.club/table/archive/normal1/|http://www.ribbit.xyz/bms/tables/normal.html"),
    ("insane1", "https://darksabun.github.io/table/archive/insane1/|https://darksabun.club/table/archive/insane1/|http://www.ribbit.xyz/bms/tables/insane.html"),
    ("normal2", "https://rattoto10.jounin.jp/table.html"),
    ("insane2", "https://rattoto10.jounin.jp/table_insane.html"),
    ("sl", "https://stellabms.xyz/sl/table.html"),
    ("st", "https://stellabms.xyz/st/table.html"),
    ("sr", "https://djkuroakari.github.io/starlighttable.html"),
    ("stardust", "https://mqppppp.neocities.org/ChartView.html"),
    ("ln", "http://flowermaster.web.fc2.com/lrnanido/gla/LN.html"),
    ("luminous", "https://ladymade-star.github.io/luminous/table.html|https://wcko87.github.io/luminous-mirror/"),
    ("scramble", "https://egret9.github.io/Scramble/"),
    ("sara", "http://minddnim.web.fc2.com/sara/3rd_hard/bms_sara_3rd_hard.html"),
]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tables")
UA = "Mozilla/5.0 (BeSmart table mirror; +https://u1908inter.github.io/besmart/about.html)"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        ctype = r.headers.get("Content-Type", "")
    m = re.search(r"charset=([\w-]+)", ctype, re.I)
    encs = ([m.group(1)] if m else []) + ["utf-8-sig", "cp932", "euc-jp"]
    for e in encs:
        try:
            return raw.decode(e)
        except (LookupError, UnicodeDecodeError):
            pass
    return raw.decode("utf-8", "replace")


def load_json(text):
    return json.loads(text.lstrip("﻿"))


def fetch_table(page):
    text = get(page)
    if re.match(r"\s*\{", text):
        header_url, header = page, load_json(text)
    else:
        m = re.search(r"<meta[^>]+name\s*=\s*[\"']bmstable[\"'][^>]*>", text, re.I)
        c = m and re.search(r"content\s*=\s*[\"']([^\"']+)[\"']", m.group(0), re.I)
        cands = [c.group(1)] if c else []
        cands += re.findall(r"[\"']([^\"'<>\s]*header[^\"'<>\s]*\.json)[\"']", text, re.I) + ["header.json"]
        header = None
        for h in cands:
            try:
                header_url = urllib.parse.urljoin(page, h)
                header = load_json(get(header_url))
                break
            except Exception:
                continue
        if header is None:
            snippet = re.sub(r"\s+", " ", text[:400])
            raise RuntimeError(f"no bmstable meta / header.json (page starts: {snippet})")
    if not header.get("data_url"):
        raise RuntimeError("header has no data_url")
    data = load_json(get(urllib.parse.urljoin(header_url, header["data_url"])))
    if not isinstance(data, list) or not data:
        raise RuntimeError("data is not a non-empty list")
    return header, data


def main():
    os.makedirs(ROOT, exist_ok=True)
    idx_path = os.path.join(ROOT, "index.json")
    try:
        index = {t["id"]: t for t in json.load(open(idx_path, encoding="utf-8"))["tables"]}
    except Exception:
        index = {}
    failed = []
    for tid, page in TABLES:
        header = data = None
        for url in page.split("|"):
            try:
                header, data = fetch_table(url)
                page = url
                break
            except Exception as e:
                print(f"[try] {tid} {url}: {e}", file=sys.stderr)
        if header is None:  # keep the previous copy
            print(f"[skip] {tid}", file=sys.stderr)
            failed.append(tid)
            continue
        d = os.path.join(ROOT, tid)
        os.makedirs(d, exist_ok=True)
        header = dict(header)
        header["data_url"] = "data.json"
        json.dump(header, open(os.path.join(d, "header.json"), "w", encoding="utf-8"), ensure_ascii=False)
        json.dump(data, open(os.path.join(d, "data.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        old = index.get(tid, {})
        changed = old.get("count") != len(data) or old.get("name") != header.get("name")
        index[tid] = {"id": tid, "src": page, "name": header.get("name", tid), "symbol": header.get("symbol", ""),
                      "count": len(data), "updated": time.strftime("%Y-%m-%d") if changed or "updated" not in old else old["updated"]}
        print(f"[ok] {tid}: {header.get('name')} ({len(data)} charts)")
    order = [t for t, _ in TABLES]
    out = {"tables": sorted(index.values(), key=lambda t: order.index(t["id"]) if t["id"] in order else 99)}
    json.dump(out, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"done: {len(TABLES) - len(failed)} ok, {len(failed)} failed {failed}")


if __name__ == "__main__":
    main()
