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
import urllib.parse
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
# 主要來源：聯合報（每類約三分之一）
# 其他來源：台視、ETtoday、中央社、風傳媒、經濟日報、科技新報、非凡新聞
# （依站長要求不收：民視、自由時報、三立、壹新聞、蘋果、新頭殼）
FB = "https://feeds.feedburner.com/"
TTV = "https://www.ttv.com.tw/rss/RSSHandler.ashx?d=news&t="
STORM = "https://www.storm.mg/api/getRss/channel_id/"
MAIN_SOURCE = "聯合報"
MAIN_SHARE = 8            # 每類最多幾則留給主要來源
PER_SOURCE = 6            # 其他每個來源每類最多幾則，讓各家平均出現

# 聯合報「即時新聞」各分類的編號
UDN = {"politics": [1], "society": [2], "world": [5, 4], "finance": [6, 10],
       "life": [9], "sports": [7], "ent": [8], "tech": [13]}
UDN_HEALTH_PATH = "/story/7266/"   # 聯合報生活類裡的「健康」文章，改放到健康分類

FEEDS = {
    "politics": [("台視", TTV + "A"), ("ETtoday", FB + "ettoday/news"), ("中央社", FB + "rsscna/politics"), ("風傳媒", STORM + "7")],
    "society":  [("台視", TTV + "C"), ("中央社", FB + "rsscna/social")],
    "world":    [("台視", TTV + "G"), ("ETtoday", FB + "ettoday/global"), ("中央社", FB + "rsscna/intworld"), ("風傳媒", STORM + "10")],
    "finance":  [("非凡新聞", "https://news.ustv.com.tw/feed"), ("台視", TTV + "B"), ("經濟日報", "https://money.udn.com/rssfeed/news/1001/5590?ch=money"),
                 ("ETtoday", FB + "ettoday/finance"), ("中央社", FB + "rsscna/finance")],
    "tech":     [("ETtoday", FB + "ettoday/teck3c"), ("中央社", FB + "rsscna/technology"), ("科技新報", "https://technews.tw/feed/")],
    "life":     [("台視", TTV + "P"), ("ETtoday", FB + "ettoday/lifestyle"), ("中央社", FB + "rsscna/lifehealth"), ("風傳媒", STORM + "5")],
    "health":   [("台視", TTV + "Z"), ("ETtoday", FB + "ettoday/health")],
    "sports":   [("台視", TTV + "J"), ("ETtoday", FB + "ettoday/sport"), ("中央社", FB + "rsscna/sport")],
    "ent":      [("台視", TTV + "F"), ("ETtoday", FB + "ettoday/star"), ("中央社", FB + "rsscna/stars")],
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
        if link.startswith("/") and "storm.mg" in url:          # 風傳媒給的是相對網址
            link = "https://www.storm.mg/article" + link.split("?")[0]
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
        vids = fetch_videos_page()
        if vids:
            print(f"  ✓ 比特王頻道（頻道頁）{len(vids)} 支影片")
            return vids
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


def _num(text):
    """「17萬」「1.2萬」「3,456」「170K」「1.2M」→ 數字"""
    t = (text or "").replace(",", "").strip()
    m = re.search(r"([\d.]+)\s*(萬|億|K|M|B)?", t, re.I)
    if not m:
        return 0
    n = float(m.group(1))
    mult = {"萬": 1e4, "億": 1e8, "K": 1e3, "M": 1e6, "B": 1e9}.get((m.group(2) or "").upper() if m.group(2) not in ("萬", "億") else m.group(2), 1)
    return int(n * mult)


def _ago_to_time(text):
    """「12 小時前」「3 天前」「2 hours ago」→ 大約的發布時間"""
    t = (text or "").lower()
    m = re.search(r"(\d+)\s*(秒|分鐘|小時|天|週|個月|年|second|minute|hour|day|week|month|year)", t)
    now = datetime.now(TW)
    if not m:
        return now.strftime("%Y-%m-%d %H:%M")
    n, u = int(m.group(1)), m.group(2)
    secs = {"秒": 1, "second": 1, "分鐘": 60, "minute": 60, "小時": 3600, "hour": 3600, "天": 86400, "day": 86400,
            "週": 604800, "week": 604800, "個月": 2592000, "month": 2592000, "年": 31536000, "year": 31536000}[u]
    return (now - timedelta(seconds=n * secs)).strftime("%Y-%m-%d %H:%M")


def fetch_videos_page():
    """備用方法：讀取頻道「影片」頁面上的公開資料"""
    url = f"https://www.youtube.com/channel/{YT_CHANNEL_ID}/videos"
    try:
        req = urllib.request.Request(url, headers={**UA, "Accept-Language": "zh-TW,zh;q=0.9"})
        with urllib.request.urlopen(req, timeout=20, context=_ctx) as r:
            page = r.read().decode("utf-8", "ignore")
        m = re.search(r"var ytInitialData = (\{.*?\});</script>", page, re.S)
        data = json.loads(m.group(1))
    except Exception as e:
        print(f"  ✗ 頻道頁讀取失敗：{e}")
        return None
    found = []

    def walk(o):
        if isinstance(o, dict):
            if "lockupViewModel" in o:
                found.append(o["lockupViewModel"])
                return
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(data)
    vids = []
    for l in found:
        if l.get("contentType") != "LOCKUP_CONTENT_TYPE_VIDEO" or not l.get("contentId"):
            continue
        try:
            md = l["metadata"]["lockupMetadataViewModel"]
            parts = [p["text"]["content"] for row in md["metadata"]["contentMetadataViewModel"]["metadataRows"]
                     for p in row.get("metadataParts", []) if "text" in p]
        except Exception:
            continue
        vids.append({
            "id": l["contentId"],
            "title": clean(md.get("title", {}).get("content", "")),
            "time": _ago_to_time(parts[1] if len(parts) > 1 else ""),
            "views": _num(parts[0] if parts else ""),
            "desc": "",
        })
    return vids[:15] or None


# ---------- 比特王 Facebook 粉專貼文 ----------
# 需要「粉專存取憑證」：放在 GitHub 的秘密設定 FB_PAGE_TOKEN，
# 或在自己電腦上存成這個資料夾裡的 .fb_token 檔（這個檔不會上傳）
GRAPH = "https://graph.facebook.com/v27.0"


def fb_token():
    t = os.environ.get("FB_PAGE_TOKEN", "").strip()
    if not t:
        try:
            t = open(os.path.join(ROOT, ".fb_token"), encoding="utf-8").read().strip()
        except Exception:
            t = ""
    return t


def fetch_fb_posts():
    token = fb_token()
    if not token:
        return None
    url = (f"{GRAPH}/me/posts?fields=id,message,full_picture,permalink_url,created_time,status_type"
           f"&limit=15&access_token={urllib.parse.quote(token)}")
    try:
        data = json.loads(fetch(url))
    except Exception as e:
        # 不把網址印出來，避免憑證出現在紀錄裡
        print(f"  ✗ 比特王 FB 抓取失敗：{type(e).__name__} {getattr(e, 'code', '')}")
        return None
    posts = []
    for x in data.get("data", []):
        text = clean(x.get("message", ""))
        img = x.get("full_picture", "")
        if not text and not img:
            continue
        try:
            t = datetime.fromisoformat(x["created_time"].replace("+0000", "+00:00")).astimezone(TW)
        except Exception:
            t = datetime.now(TW)
        posts.append({
            "id": x.get("id", ""),
            "text": text[:300],
            "img": img,
            "link": x.get("permalink_url", ""),
            "time": t.strftime("%Y-%m-%d %H:%M"),
        })
    print(f"  ✓ 比特王 FB {len(posts)} 則貼文")
    return posts


# ---------- 比特王報導（AI 根據新聞標題與摘要，用自己的話重新整理） ----------
# 需要 Anthropic 的 API 金鑰：放在 GitHub 秘密設定 ANTHROPIC_API_KEY。沒有金鑰就不會呼叫 AI、也不會產生費用。
AI_MODEL = "claude-opus-5-5"   # 可改成 "claude-sonnet-5-5"（中間）或 "claude-haiku-5-5"（經濟）
AI_MAX_PER_RUN = 40            # 每次更新最多幫幾則新聞寫報導（控制費用）
AI_SYSTEM = """你是「比特王新聞網」的新聞編輯。你會收到一則新聞的標題、摘要與原始媒體名稱。
請用你自己的話，寫一篇約 300 字的繁體中文報導，幫讀者看懂這則新聞：
1. 先用一兩句話說清楚發生了什麼事。
2. 再說明相關的背景，以及這件事為什麼重要、可能帶來什麼影響。
規則：
- 只能根據提供的標題與摘要陳述事實，不可以編造摘要裡沒有的數字、日期、人名、引言或細節；背景說明用一般性的常識，不確定就不要寫。
- 不要逐句改寫或照抄摘要，要用自己的結構與文字重新說明。
- 語氣客觀、清楚、口語好讀；段落之間空一行；不要加標題、不要列點符號、不要寫「根據報導」以外的出處。
- 只輸出報導本文。"""


def previous_reports():
    """沿用之前已經寫好的報導（本機的 news.json 與正式網站上的），避免重複花錢"""
    old = {}
    for src in ("local", "live"):
        try:
            data = json.load(open(OUT, encoding="utf-8")) if src == "local" else json.loads(fetch(LIVE_SITE))
            for a in data.get("articles", []):
                if a.get("report"):
                    old.setdefault(a["id"], a["report"])
        except Exception:
            pass
    return old


def write_reports(final):
    old = previous_reports()
    for it in final:
        if it["id"] in old:
            it["report"] = old[it["id"]]
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(f"  ・比特王報導：沒有 AI 金鑰，沿用舊報導 {sum(1 for it in final if it.get('report'))} 則")
        return
    try:
        import anthropic
    except ImportError:
        print("  ・比特王報導：沒有安裝 anthropic 套件，略過")
        return
    client = anthropic.Anthropic()
    need = sorted([it for it in final if not it.get("report")], key=lambda x: x["time"], reverse=True)[:AI_MAX_PER_RUN]

    def one(it):
        prompt = f"新聞標題：{it['title']}\n原始媒體：{it['source']}\n新聞摘要：{it['summary']}"
        try:
            kwargs = dict(model=AI_MODEL, max_tokens=4000, system=AI_SYSTEM,
                          output_config={"effort": "low"},
                          messages=[{"role": "user", "content": prompt}])
            if AI_MODEL in ("claude-opus-5-5", "claude-sonnet-5-5"):
                # 萬一 AI 婉拒，由 Anthropic 自動改用其他模型重試
                r = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
            else:
                r = client.messages.create(**kwargs)
        except anthropic.RateLimitError:
            return None
        except anthropic.APIStatusError as e:
            print(f"  ✗ 比特王報導失敗（{e.status_code}）")
            return None
        except anthropic.APIConnectionError:
            return None
        if r.stop_reason in ("refusal", "max_tokens"):
            return None
        text = "".join(b.text for b in r.content if b.type == "text").strip()
        return text or None

    done = 0
    with ThreadPoolExecutor(4) as ex:
        for it, text in zip(need, ex.map(one, need)):
            if text:
                it["report"] = text
                done += 1
    print(f"  ✓ 比特王報導：新寫 {done} 則，共 {sum(1 for it in final if it.get('report'))} 則有報導")


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
    # 各網站寫法不同（單／雙引號、大小寫），都要認得
    m = (re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', page, re.I)
         or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', page, re.I))
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
        # 其他來源：每家最多 PER_SOURCE 則，依時間先後挑，讓各家平均出現
        per, others = {}, []
        for x in uniq:
            if x["source"] in (MAIN_SOURCE, "非凡新聞"):
                continue
            if per.get(x["source"], 0) < PER_SOURCE:
                per[x["source"]] = per.get(x["source"], 0) + 1
                others.append(x)
        kept = main + must + others[:max(0, PER_CATEGORY - len(main) - len(must))]
        if len(kept) < PER_CATEGORY:                # 還不夠時，先用其他來源、再用聯合報補滿
            extra = [x for x in uniq if x not in kept and x["source"] != MAIN_SOURCE] + \
                    [x for x in uniq if x not in kept and x["source"] == MAIN_SOURCE]
            kept += extra[:PER_CATEGORY - len(kept)]
        kept.sort(key=lambda x: x["time"], reverse=True)
        final.extend(kept)

    # 補封面圖（記住找過的，下次不用再找）
    try:
        cache = json.load(open(CACHE, encoding="utf-8"))
    except Exception:
        cache = {}
    need = [it for it in final if not it["img"] and not cache.get(it["link"])]   # 上次沒找到的也再試一次
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
    write_reports(final)
    videos = fetch_videos()
    if videos:
        try:                                        # 存一份備援清單，下次抓不到時使用
            json.dump(videos, open(VIDEO_BACKUP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        except Exception:
            pass
    else:
        videos = backup_videos()
    fbposts = fetch_fb_posts()
    if fbposts is None:                             # 沒有憑證或這次失敗：沿用上次的貼文
        try:
            fbposts = json.loads(fetch(LIVE_SITE)).get("fbposts", [])
        except Exception:
            fbposts = []
    data = {"updated": datetime.now(TW).strftime("%Y-%m-%d %H:%M:%S"), "articles": final, "videos": videos,
            "fbposts": fbposts,
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
