"""
比特王新聞網 — 產生每則新聞的獨立網頁（給 Google 收錄、給 LINE／FB 分享預覽）
用法：python build_pages.py 輸出資料夾
  會產生：news/編號.html、sitemap.xml、archive.json、404.html、robots.txt
新聞頁保留 7 天（存在 archive.json，每次從正式網站接續累積）。
"""
import html
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

SITE = "https://beckwang888.github.io/bitking-news/"
KEEP_DAYS = 7
TW = timezone(timedelta(hours=8))
ROOT = os.path.dirname(os.path.abspath(__file__))
CATS = {
    "politics": ("政治", "#dc2626"), "society": ("社會", "#475569"), "world": ("國際", "#2563eb"),
    "finance": ("財經", "#d97706"), "tech": ("科技", "#7c3aed"), "life": ("生活", "#059669"),
    "health": ("健康", "#0891b2"), "sports": ("體育", "#ea580c"), "ent": ("娛樂", "#db2777"),
    "travel": ("旅遊", "#0d9488"),
}
e = lambda s: html.escape(str(s or ""), quote=True)


def load_archive():
    try:
        req = urllib.request.Request(SITE + "archive.json", headers={"User-Agent": "BitKingNews/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8")).get("items", [])
    except Exception:
        return []


def paragraphs(text):
    return "".join(f"<p>{e(p.strip())}</p>" for p in str(text).split("\n") if p.strip())


def page(a, version):
    cat_name, color = CATS.get(a["cat"], ("新聞", "#e11d48"))
    url = f"{SITE}news/{a['id']}.html"
    img = a.get("img") or (SITE + "share.png")
    desc = (a.get("report") or a.get("summary") or "")[:120].replace("\n", " ")
    t = a["time"].replace(" ", "T") + ":00+08:00"
    ld = {
        "@context": "https://schema.org", "@type": "NewsArticle",
        "headline": a["title"][:110], "description": desc, "image": [img],
        "datePublished": t, "dateModified": t, "mainEntityOfPage": url,
        "author": {"@type": "Organization", "name": a["source"]},
        "publisher": {"@type": "Organization", "name": "比特王新聞網",
                      "logo": {"@type": "ImageObject", "url": SITE + "logo.png"}},
        "isBasedOn": a.get("link", ""),
    }
    report = ""
    if a.get("report"):
        report = f"""
      <section class="our-report">
        <h2><img src="../logo.png" alt="">比特王報導</h2>
        <div class="reader-body">{paragraphs(a['report'])}</div>
        <p class="ai-note">本段由比特王新聞網以 AI 協助整理，事實內容以原始報導為準。</p>
      </section>"""
    return f"""<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{e(a['title'])}｜比特王新聞網</title>
  <meta name="description" content="{e(desc)}">
  <link rel="canonical" href="{url}">
  <link rel="icon" href="../logo.png" type="image/png">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="比特王新聞網">
  <meta property="og:locale" content="zh_TW">
  <meta property="og:title" content="{e(a['title'])}">
  <meta property="og:description" content="{e(desc)}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{e(img)}">
  <meta property="article:published_time" content="{t}">
  <meta name="twitter:card" content="summary_large_image">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=Noto+Serif+TC:wght@700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../styles.css?v={version}">
  <script>try{{const t=localStorage.getItem("btk-theme");if(t)document.documentElement.dataset.theme=t;const f=localStorage.getItem("btk-font");if(f)document.documentElement.style.setProperty("--read-size",f+"px")}}catch(e){{}}</script>
  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")}</script>
</head>
<body>
  <header class="masthead"><div class="wrap masthead-inner">
    <a href="../" class="logo"><img class="logo-mark" src="../logo.png" alt="比特王">
      <span class="logo-text"><strong>比特王新聞網</strong><small>看懂世界，從這裡開始</small></span></a>
    <a class="sub-btn" href="../">回首頁看更多新聞</a>
  </div></header>
  <main class="wrap">
    <article class="reader-article" style="--c:{color}">
      <a class="tag" href="../#cat/{e(a['cat'])}" style="--c:{color}">{cat_name}</a>
      <h1>{e(a['title'])}</h1>
      <div class="reader-meta"><span>來源 <b>{e(a['source'])}</b></span><span>{e(a['time'].replace('-', '/'))}</span></div>
      {f'<figure class="reader-cover" style="margin:28px 0 8px"><img src="{e(img)}" alt="" referrerpolicy="no-referrer"></figure><div class="reader-caption">圖片來源：{e(a["source"])}</div>' if a.get("img") else ""}
      <div class="src-summary"><span>原始新聞摘要・{e(a['source'])}</span><p>{e(a.get('summary', ''))}</p></div>
      {report}
      <a class="read-full" href="{e(a.get('link', ''))}" target="_blank" rel="noopener">
        <span><small>原始報導請至</small>{e(a['source'])} 閱讀</span><b>↗</b></a>
      <div class="reader-share"><a class="google-btn" href="../#news/{e(a['id'])}">💬 到比特王新聞網看留言、更多相關新聞</a></div>
      <div class="reader-note">※ 比特王新聞網彙整各大媒體公開的新聞摘要，原文版權屬原媒體所有。</div>
    </article>
  </main>
  <footer class="footer"><div class="wrap footer-inner"><p class="footer-copy">© 2026 比特王新聞網</p></div></footer>
</body>
</html>"""


def main(out):
    version = os.environ.get("GITHUB_SHA", "local")[:8]
    news = json.load(open(os.path.join(ROOT, "news.json"), encoding="utf-8"))["articles"]
    cutoff = (datetime.now(TW) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d %H:%M")
    keep = {}
    for a in load_archive() + news:                 # 新的蓋掉舊的（例如後來才寫好的報導）
        if a.get("id", "").startswith("p_") or a.get("time", "") < cutoff:
            continue
        old = keep.get(a["id"])
        if old and old.get("report") and not a.get("report"):
            a = {**a, "report": old["report"]}
        keep[a["id"]] = {k: a.get(k, "") for k in ("id", "cat", "title", "summary", "source", "link", "time", "img", "report")}
    items = sorted(keep.values(), key=lambda x: x["time"], reverse=True)

    os.makedirs(os.path.join(out, "news"), exist_ok=True)
    for a in items:
        with open(os.path.join(out, "news", f"{a['id']}.html"), "w", encoding="utf-8") as f:
            f.write(page(a, version))
    with open(os.path.join(out, "archive.json"), "w", encoding="utf-8") as f:
        json.dump({"items": items}, f, ensure_ascii=False, separators=(",", ":"))

    today = datetime.now(TW).strftime("%Y-%m-%d")
    urls = [f"<url><loc>{SITE}</loc><lastmod>{today}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>"]
    urls += [f"<url><loc>{SITE}news/{a['id']}.html</loc><lastmod>{a['time'][:10]}</lastmod></url>" for a in items]
    with open(os.path.join(out, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + "\n".join(urls) + "\n</urlset>\n")
    with open(os.path.join(out, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(f"User-agent: *\nAllow: /\nSitemap: {SITE}sitemap.xml\n")
    with open(os.path.join(out, "404.html"), "w", encoding="utf-8") as f:
        f.write('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>比特王新聞網</title>'
                '<meta name="robots" content="noindex"><script>location.replace("/bitking-news/")</script></head>'
                '<body><p>這則新聞已下架，正在帶你回到<a href="/bitking-news/">比特王新聞網首頁</a>…</p></body></html>')
    print(f"  ✓ 新聞獨立網頁：{len(items)} 頁（保留 {KEEP_DAYS} 天），網站地圖已更新")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
