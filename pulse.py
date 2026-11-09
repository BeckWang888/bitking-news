"""
比特王新聞網 — 輿情分析統計
==========================================
依據過去 24 小時收錄的新聞，自動統計：
  - 今日新聞排行榜：藍、綠、白三個陣營，各取熱度最高的 10 則
  - 今日風向熱度：政治人物聲量、政治議題、台灣新聞、國際事件、AI 事件、美股公司、台股公司

「熱度」＝同一件事被幾則新聞、幾家媒體報導（報導越多越熱）。
「聲量」＝被多少則新聞提到。這是新聞聲量統計，不是民調。

下面的名單（人物、議題、公司）可以自己增減，改完存檔即可。
"""
import re
from collections import Counter, defaultdict

# ---------- 陣營關鍵字（判斷新聞跟哪個陣營有關） ----------
CAMP_WORDS = {
    "blue":  ["國民黨", "藍營", "藍委", "國民黨團", "藍白"],
    "green": ["民進黨", "綠營", "綠委", "民進黨團", "賴政府"],
    "white": ["民眾黨", "白營", "小草", "民眾黨團", "藍白"],
}

# ---------- 政治人物（姓名：陣營）；intl＝國際人物 ----------
PEOPLE = {
    "blue": ["鄭麗文", "朱立倫", "盧秀燕", "蔣萬安", "韓國瑜", "侯友宜", "傅崐萁", "李四川", "江啟臣", "王鴻薇",
             "羅智強", "趙少康", "張嘉郡", "楊瓊瓔", "徐巧芯", "馬英九", "陳玉珍", "柯志恩", "翁曉玲", "李彥秀", "謝衣鳯"],
    "green": ["賴清德", "蕭美琴", "卓榮泰", "沈伯洋", "蘇巧慧", "何欣純", "林佳龍", "鄭麗君", "陳其邁", "賴瑞隆",
              "劉建國", "柯建銘", "林右昌", "王義川", "吳思瑤", "陳時中", "管碧玲", "顧立雄", "林俊憲", "蔡英文", "莊瑞雄"],
    "white": ["柯文哲", "黃國昌", "張啓楷", "邱臣遠", "麥玉珍", "黃珊珊", "吳春城", "陳昭姿", "林憶君", "劉書彬", "陳佩琪"],
    "intl":  ["川普", "習近平", "黃仁勳", "馬斯克", "普丁", "澤倫斯基", "高市早苗", "李在明"],
}

# ---------- 政治議題（議題名稱：相關字詞） ----------
ISSUES = {
    "地方選舉": ["選舉", "參選", "候選人", "造勢", "政見", "選情", "拜票"],
    "兩岸關係": ["兩岸", "共機", "共艦", "中共", "統戰", "陸委會", "解放軍"],
    "國防軍購": ["國防", "軍購", "特別預算", "國軍", "國防部"],
    "美台關係與關稅": ["關稅", "美方", "白宮", "美國國務院", "對美"],
    "能源與核電": ["核電", "核三", "能源", "電價", "缺電", "綠電", "台電"],
    "國會與修法": ["立法院", "國會", "修法", "三讀", "立委"],
    "司法與弊案": ["起訴", "羈押", "貪污", "弊案", "檢調", "收押", "判刑"],
    "財政預算": ["預算", "財劃法", "統籌分配", "追加"],
    "普發現金與經濟": ["普發", "物價", "通膨", "減稅", "薪資"],
    "社福與長照": ["年金", "長照", "社福", "托育", "育兒"],
    "居住與房市": ["房價", "房市", "囤房", "社宅", "房貸"],
    "詐騙與治安": ["詐騙", "詐團", "治安", "黑道"],
    "外交與國際參與": ["外交", "邦交", "友邦", "外交部"],
}

AI_WORDS = ["AI", "人工智慧", "生成式", "ChatGPT", "OpenAI", "Gemini", "Claude", "大型語言模型", "機器人", "算力", "資料中心", "Anthropic"]

# ---------- 美股、台股公司（顯示名稱：要找的字詞） ----------
US_STOCKS = {
    "輝達": ["輝達", "NVIDIA", "Nvidia", "黃仁勳"], "蘋果": ["蘋果", "Apple", "iPhone"], "微軟": ["微軟", "Microsoft"],
    "Google": ["Google", "谷歌", "Alphabet"], "亞馬遜": ["亞馬遜", "Amazon", "AWS"], "Meta": ["Meta", "臉書"],
    "特斯拉": ["特斯拉", "Tesla"], "博通": ["博通", "Broadcom"], "超微": ["超微", "AMD"], "英特爾": ["英特爾", "Intel"],
    "甲骨文": ["甲骨文", "Oracle"], "美光": ["美光", "Micron"], "高通": ["高通", "Qualcomm"], "OpenAI": ["OpenAI", "ChatGPT"],
    "波音": ["波音", "Boeing"], "網飛": ["網飛", "Netflix"], "CoreWeave": ["CoreWeave"], "Palantir": ["Palantir"],
}
TW_STOCKS = {
    "台積電": ["台積電"], "鴻海": ["鴻海"], "聯發科": ["聯發科"], "廣達": ["廣達"], "緯創": ["緯創"], "緯穎": ["緯穎"],
    "華碩": ["華碩"], "宏碁": ["宏碁"], "聯電": ["聯電"], "日月光": ["日月光"], "台達電": ["台達電"], "中華電": ["中華電"],
    "富邦金": ["富邦金"], "國泰金": ["國泰金"], "長榮": ["長榮"], "陽明": ["陽明海運", "陽明"], "萬海": ["萬海"],
    "友達": ["友達"], "群創": ["群創"], "大立光": ["大立光"], "華邦電": ["華邦電"], "南亞科": ["南亞科"], "技嘉": ["技嘉"],
    "微星": ["微星"], "英業達": ["英業達"], "仁寶": ["仁寶"], "中鋼": ["中鋼"], "台塑": ["台塑"], "華航": ["華航"],
    "智邦": ["智邦"], "世芯": ["世芯"], "力積電": ["力積電"], "欣興": ["欣興"], "奇鋐": ["奇鋐"], "台光電": ["台光電"],
}

TAIWAN_CATS = {"politics", "society", "life", "health", "finance", "sports", "ent", "tech", "travel"}


def text_of(it):
    return f"{it.get('title', '')} {it.get('summary', '')}"


# 這些是很多新聞共用的「格式字」，不能拿來判斷是不是同一件事
TEMPLATE_WORDS = ["營收", "億元", "萬元", "月減", "月增", "年增", "年減", "最新", "曝光", "回應", "一次看", "快訊"]


def bigrams(title):
    s = re.sub(r"[\s\W_\d]+", "", title)            # 去掉空白、符號、數字
    for w in TEMPLATE_WORDS:
        s = s.replace(w, "|")
    return {s[i:i + 2] for i in range(len(s) - 1) if "|" not in s[i:i + 2]}


def cluster(items, threshold=0.32):
    """把標題很像的新聞歸成同一件事"""
    groups = []   # 每組：{"keys": set, "items": [...]}
    for it in sorted(items, key=lambda x: x["time"], reverse=True):
        b = bigrams(it["title"])
        if not b:
            continue
        best, score = None, 0
        for g in groups:
            inter = len(b & g["keys"])
            if inter < 3:                                      # 共同的詞太少，不算同一件事
                continue
            sim = inter / max(1, min(len(b), len(g["keys"])))     # 用較短標題當分母，轉寫的標題也認得
            jac = inter / max(1, len(b | g["keys"]))
            s = max(jac, sim * 0.8)
            if s > score:
                best, score = g, s
        if best and score >= threshold:
            best["items"].append(it)
        else:
            groups.append({"keys": b, "items": [it]})
    out = []
    for g in groups:
        its = g["items"]
        rep = next((x for x in its if x.get("img")), its[0])
        srcs = sorted({x["source"] for x in its})
        out.append({
            "title": its[0]["title"], "id": rep["id"], "link": rep.get("link", ""), "img": rep.get("img", ""),
            "source": rep["source"], "sources": srcs, "count": len(its), "time": its[0]["time"],
            "heat": len(its) + 0.5 * (len(srcs) - 1),
        })
    out.sort(key=lambda x: (x["heat"], x["time"]), reverse=True)
    return out


def top(clusters, n=10):
    if not clusters:
        return []
    mx = clusters[0]["heat"] or 1
    res = []
    for c in clusters[:n]:
        c = dict(c)
        c["score"] = round(c["heat"] / mx * 100)
        res.append(c)
    return res


def count_terms(items, table):
    cnt = Counter()
    for it in items:
        t = text_of(it)
        for name, words in table.items():
            if any(w in t for w in words):
                cnt[name] += 1
    return [{"name": k, "count": v} for k, v in cnt.most_common() if v > 0]


def build_pulse(pool):
    """pool：過去 24 小時收到的所有新聞"""
    political = [it for it in pool if it["cat"] in ("politics", "society")]

    # 陣營新聞排行榜
    camps = {}
    camp_people = {c: PEOPLE[c] for c in ("blue", "green", "white")}
    for camp in ("blue", "green", "white"):
        words = CAMP_WORDS[camp] + camp_people[camp]
        rel = [it for it in pool if it["cat"] in ("politics", "society", "world", "finance")
               and any(w in it["title"] for w in words)]
        # 標題沒寫但摘要有提到陣營的，也算進來
        seen = {it["id"] for it in rel}
        rel += [it for it in political if it["id"] not in seen and sum(text_of(it).count(w) for w in words) >= 2]
        camps[camp] = top(cluster(rel), 10)

    # 政治人物聲量
    people = []
    for camp, names in PEOPLE.items():
        for nm in names:
            c = sum(1 for it in pool if nm in text_of(it))
            if c:
                people.append({"name": nm, "camp": camp, "count": c})
    people.sort(key=lambda x: x["count"], reverse=True)
    share = defaultdict(int)
    for p in people:
        if p["camp"] != "intl":
            share[p["camp"]] += p["count"]

    tw_items = [it for it in pool if it["cat"] in TAIWAN_CATS]
    world_items = [it for it in pool if it["cat"] == "world"]
    ai_items = [it for it in pool if any(w in it["title"] for w in AI_WORDS)]

    return {
        "total": len(pool),
        "sources": sorted({it["source"] for it in pool}),
        "camps": camps,
        "people": people[:40],
        "campShare": {k: share.get(k, 0) for k in ("blue", "green", "white")},
        "issues": count_terms(political + [it for it in pool if it["cat"] == "world"], ISSUES)[:12],
        "taiwan": top(cluster(tw_items), 10),
        "world": top(cluster(world_items), 10),
        "ai": top(cluster(ai_items), 10),
        "usStocks": count_terms(pool, US_STOCKS)[:12],
        "twStocks": count_terms(pool, TW_STOCKS)[:12],
    }
