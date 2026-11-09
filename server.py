"""
比特王新聞網 — 新聞自動更新＋網站伺服器
==========================================
用法：
  python server.py          啟動網站（http://localhost:5520），並且每 10 分鐘自動抓一次新聞
  python server.py --once   只抓一次新聞、存成 news.json 就結束（之後放到網路上時會用到）

新聞來源（各家公開提供的 RSS 新聞訂閱）：
  聯合報（主要）、ETtoday 新聞雲、中央社、TechNews 科技新報、非凡新聞（財經）
本站只顯示「標題＋摘要＋圖片」，並附上原文連結，完整內容請讀者到原網站閱讀。
"""
import hashlib
import html
import http.server
import json
import os
import re
import socketserver
import ssl
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "news.json")
CACHE = os.path.join(ROOT, ".cache_images.json")
PORT = int(os.environ.get("PORT", 5520))
REFRESH_MIN = 10          # 幾分鐘更新一次
PER_CATEGORY = 24         # 每個分類保留幾則
TW = timezone(timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BitKingNews/1.0"}

# ---------- 比特王 YouTube 頻道 ----------
YT_CHANNEL_ID = "UCJHq28mKJowPCGQ0WDIDU9A"   # Bit King比特王出任務
YT_FEEDS = [                                   # 兩種官方訂閱網址輪流試
    "https://www.youtube.com/feeds/videos.xml?channel_id=" + YT_CHANNEL_ID,
    "https://www.youtube.com/feeds/videos.xml?playlist_id=UU" + YT_CHANNEL_ID[2:],
]

# ---------- 每個分類要抓哪些來源 ----------
# 主要來源：聯合報（每類保留約一半的版面給聯合報）
# 輔助來源：ETtoday、中央社、科技新報；財經另加非凡新聞
FB = "https://feeds.feedburner.com/"
MAIN_SOURCE = "聯合報"
MAIN_SHARE = 12           # 每類最多幾則留給主要來源

# 聯合報「即時新聞」各分類的編號
UDN = {"politics": [1], "society": [2], "world": [5, 4], "finance": [6, 10],
       "life": [9], "sports": [7], "ent": [8], "tech": [13]}
UDN_HEALTH_PATH = "/story/7266/"   # 聯合報生活類裡的「健康」文章，改放到健康分類

FEEDS = {
    "politics": [("ETtoday", FB + "ettoday/news"), ("中央社", FB + "rsscna/politics")],
    "society":  [("中央社", FB + "rsscna/social")],
    "world":    [("ETtoday", FB + "ettoday/global"), ("中央社", FB + "rsscna/intworld")],
    "finance":  [("非凡新聞", "https://news.ustv.com.tw/feed"), ("ETtoday", FB + "ettoday/finance"), ("中央社", FB + "rsscna/finance")],
    "tech":     [("ETtoday", FB + "ettoday/teck3c"), ("中央社", FB + "rsscna/technology"), ("科技新報", "https://technews.tw/feed/")],
    "life":     [("ETtoday", FB + "ettoday/lifestyle"), ("中央社", FB + "rsscna/lifehealth")],
    "health":   [("ETtoday", FB + "ettoday/health")],
    "sports":   [("ETtoday", FB + "ettoday/sport"), ("中央社", FB + "rsscna/sport")],
    "ent":      [("ETtoday", FB + "ettoday/star"), ("中央社", FB + "rsscna/stars")],
    "travel":   [("ETtoday", FB + "ettoday/travel")],
}

# 有些網站的安全憑證格式較舊，放寬「嚴格檢查」但仍然驗證憑證
_ctx = ssl.create_default_context()
if hasattr(ssl, "VERIFY_X509_STRICT"):
    _ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=_ctx) as r:
        return r.read().decode("utf-8", "ignore")


def clean(s):
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s or "", flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(html.unescape(s))
    return re.sub(r"\s+", " ", s).strip()


def tag(block, name):
    m = re.search(rf"<{name}[^>]*>(.*?)</{name}>", block, re.S)
    return m.group(1) if m else ""


def parse_time(s):
    s = clean(s)
    try:                                            # 例如 2026-11-08T18:15:05+08:00
        d = datetime.fromisoformat(s)
        return (d if d.tzinfo else d.replace(tzinfo=TW)).astimezone(TW)
    except ValueError:
        pass
    s = re.sub(r",(?=\S)", ", ", s)
    try:
        d = parsedate_to_datetime(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=TW)
        return d.astimezone(TW)
    except Exception:
        return datetime.now(TW)


def summarize(text, n=150):
    text = re.sub(r"^（中央社[^）]{0,40}）", "", text)        # 去掉「（中央社記者…電）」開頭
    text = re.sub(r"^首次上稿\s*[\d:]+\s*(更新時間\s*[\d:]+)?\s*", "", text)  # 自由時報的時間標記
    text = re.sub(r"\s*\[(…|\.\.\.)\]\s*$", "", text)
    text = re.sub(r"(…|\.\.\.)+$", "", text).strip(" …")
    return text if len(text) <= n else text[:n].rstrip() + "…"


def parse_feed(cat, source, url):
    try:
        xml = fetch(url)
    except Exception as e:
        print(f"  ✗ {source} {cat} 抓取失敗：{e}")
        return []
    items = []
    for block in re.findall(r"<item[\s>].*?</item>", xml, re.S):
        title = clean(tag(block, "title"))
        link = clean(tag(block, "link"))
        if not title or not link:
            continue
        raw_desc = tag(block, "description")
        raw_desc = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", raw_desc, flags=re.S)
        img = ""
        m = (re.search(r'<img[^>]+src="([^"]+)"', html.unescape(raw_desc))
             or re.search(r'<media:content[^>]+url="([^"]+)"', block)
             or re.search(r'<enclosure[^>]+url="([^"]+\.(?:jpe?g|png|webp)[^"]*)"', block))
        if m:
            img = m.group(1)
        if "ettoday.net/images" in img:            # ETtoday 換成高解析度版本
            img = re.sub(r"/[a-z](\d+\.(?:jpe?g|png))$", r"/e\1", img)
        desc = clean(raw_desc)
        desc = re.sub(r"\s*(閱讀全文|看更多|More)\s*$", "", desc)
        t = parse_time(tag(block, "pubDate"))
        items.append({
            "id": hashlib.md5(link.encode()).hexdigest()[:10],
            "cat": cat,
            "title": title,
            "summary": summarize(desc),
            "source": source,
            "link": link,
            "time": t.strftime("%Y-%m-%d %H:%M"),
            "img": img,
        })
    print(f"  ✓ {source:<5} {cat:<9} {len(items)} 則")
    return items


def parse_udn(cat, cate_id, pages=2):
    """聯合報即時新聞列表（聯合新聞網公開的新聞列表資料）"""
    items = []
    for page in range(1, pages + 1):
        url = f"https://udn.com/api/more?page={page}&id=&channelId=1&cate_id={cate_id}&type=breaknews"
        try:
            data = json.loads(fetch(url))
        except Exception as e:
            print(f"  ✗ 聯合報 {cat} 第{page}頁抓取失敗：{e}")
            break
        for x in data.get("lists", []):
            path = (x.get("titleLink") or "").split("?")[0]
            title = clean(x.get("title"))
            if not path or not title:
                continue
            link = path if path.startswith("http") else "https://udn.com" + path
            c = "health" if cat == "life" and UDN_HEALTH_PATH in path else cat
            t = (x.get("time") or {}).get("date", "")[:16] or datetime.now(TW).strftime("%Y-%m-%d %H:%M")
            items.append({
                "id": hashlib.md5(link.encode()).hexdigest()[:10],
                "cat": c,
                "title": title,
                "summary": summarize(clean(x.get("paragraph"))),
                "source": "聯合報",
                "link": link,
                "time": t,
                "img": x.get("url") or "",
            })
        if data.get("end") and page >= pages:
            break
    print(f"  ✓ 聯合報   {cat:<9} {len(items)} 則")
    return items


def fetch_videos():
    """比特王頻道最新影片（YouTube 官方公開的頻道訂閱，最多 15 支）"""
    xml, err = None, ""
    for attempt in range(6):                        # YouTube 偶爾會暫時失敗，多試幾次
        try:
            xml = fetch(YT_FEEDS[attempt % len(YT_FEEDS)])
            if "<entry>" in xml:
                break
            err = "內容沒有影片"
        except Exception as e:
            err = str(e)
        time.sleep(2 + attempt * 2)
    if not xml or "<entry>" not in xml:
        print(f"  ✗ 比特王頻道 抓取失敗（{err}），改用備援影片清單")
        return None
    vids = []
    for block in re.findall(r"<entry>.*?</entry>", xml, re.S):
        vid = clean(tag(block, "yt:videoId"))
        if not vid:
            continue
        views = re.search(r'<media:statistics views="(\d+)"', block)
        vids.append({
            "id": vid,
            "title": clean(tag(block, "title")),
            "time": parse_time(tag(block, "published")).strftime("%Y-%m-%d %H:%M"),
            "views": int(views.group(1)) if views else 0,
            "desc": summarize(clean(tag(block, "media:description")), 120),
        })
    print(f"  ✓ 比特王頻道 {len(vids)} 支影片")
    return vids


VIDEO_BACKUP = os.path.join(ROOT, "videos-backup.json")
LIVE_SITE = "https://beckwang888.github.io/bitking-news/news.json"


def backup_videos():
    """抓不到 YouTube 時：依序改用 上次的 news.json → 正式網站目前的清單 → 備援清單檔"""
    cands = []
    try:
        cands.append(json.load(open(OUT, encoding="utf-8")).get("videos", []))
    except Exception:
        pass
    try:
        cands.append(json.loads(fetch(LIVE_SITE)).get("videos", []))
    except Exception:
        pass
    try:
        cands.append(json.load(open(VIDEO_BACKUP, encoding="utf-8")))
    except Exception:
        pass
    # 選「最新一支影片時間最晚」的那份
    cands = [c for c in cands if c]
    if not cands:
        return []
    best = max(cands, key=lambda c: max(v.get("time", "") for v in c))
    print(f"  ↺ 使用備援影片清單（{len(best)} 支）")
    return best


def find_cover(link):
    """沒有附圖的新聞，到原文頁面找封面圖（og:image）"""
    try:
        page = fetch(link, timeout=10)[:200000]
    except Exception:
        return ""
    m = (re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', page)
         or re.search(r'<meta[^>]+content="([^"]+)"[^>]+property="og:image"', page))
    img = html.unescape(m.group(1)) if m else ""
    if "pic_fb" in img or "logo" in img.lower() or "default" in img.lower():
        return ""                                   # 網站預設圖不算
    return img


def build():
    started = time.time()
    print(f"[{datetime.now(TW):%H:%M:%S}] 開始抓新聞…")
    jobs = [(parse_feed, (c, s, u)) for c, lst in FEEDS.items() for s, u in lst]
    jobs += [(parse_udn, (c, cid)) for c, ids in UDN.items() for cid in ids]
    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(lambda j: j[0](*j[1]), jobs))

    by_cat = {c: [] for c in FEEDS}
    for items in results:
        for it in items:
            by_cat[it["cat"]].append(it)

    seen, final = set(), []
    for cat, items in by_cat.items():
        items.sort(key=lambda x: x["time"], reverse=True)
        uniq = []
        for it in items:
            key = re.sub(r"\W", "", it["title"])[:18]
            if key in seen:
                continue
            seen.add(key)
            uniq.append(it)
        # 先放聯合報（最多 MAIN_SHARE 則），其餘名額給其他來源，再依時間排序
        main = [x for x in uniq if x["source"] == MAIN_SOURCE][:MAIN_SHARE]
        must = [x for x in uniq if x["source"] == "非凡新聞"][:6]
        others = [x for x in uniq if x["source"] not in (MAIN_SOURCE, "非凡新聞")]
        kept = main + must + others[:max(0, PER_CATEGORY - len(main) - len(must))]
        if len(kept) < PER_CATEGORY:                # 其他來源不夠時，再用聯合報補滿
            extra = [x for x in uniq if x["source"] == MAIN_SOURCE and x not in main]
            kept += extra[:PER_CATEGORY - len(kept)]
        kept.sort(key=lambda x: x["time"], reverse=True)
        final.extend(kept)

    # 補封面圖（記住找過的，下次不用再找）
    try:
        cache = json.load(open(CACHE, encoding="utf-8"))
    except Exception:
        cache = {}
    need = [it for it in final if not it["img"] and it["link"] not in cache]
    if need:
        with ThreadPoolExecutor(8) as ex:
            for it, img in zip(need, ex.map(lambda x: find_cover(x["link"]), need)):
                cache[it["link"]] = img
    for it in final:
        if not it["img"]:
            it["img"] = cache.get(it["link"], "")
    keep = {it["link"] for it in final}
    cache = {k: v for k, v in cache.items() if k in keep}
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    if not final:
        print("  ⚠ 這次沒有抓到任何新聞（可能是網路問題），保留舊資料。")
        return
    videos = fetch_videos()
    if videos:
        try:                                        # 存一份備援清單，下次抓不到時使用
            json.dump(videos, open(VIDEO_BACKUP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        except Exception:
            pass
    else:
        videos = backup_videos()
    data = {"updated": datetime.now(TW).strftime("%Y-%m-%d %H:%M:%S"), "articles": final, "videos": videos,
            "channel": "https://www.youtube.com/channel/" + YT_CHANNEL_ID}
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    with_img = sum(1 for it in final if it["img"])
    print(f"  完成：共 {len(final)} 則（{with_img} 則有圖），花了 {time.time() - started:.0f} 秒")


def loop():
    while True:
        time.sleep(REFRESH_MIN * 60)
        try:
            build()
        except Exception as e:
            print("  更新失敗：", e)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        if self.path.startswith("/news.json"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass
    if "--once" in sys.argv:
        build()
        sys.exit(0)
    threading.Thread(target=build, daemon=True).start()
    threading.Thread(target=loop, daemon=True).start()
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        print(f"比特王新聞網已啟動：http://localhost:{PORT}　（每 {REFRESH_MIN} 分鐘自動更新新聞，關閉此視窗即停止）")
        httpd.serve_forever()
