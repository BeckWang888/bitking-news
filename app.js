/* ============================================================
   比特王新聞網 — 網站運作邏輯
   新聞來自 news.json（由 server.py 自動抓取更新）
   網址規則：
     #            首頁
     #cat/tech    某個分類
     #search/字   搜尋結果
     #news/編號   閱讀某篇新聞
   ============================================================ */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const catOf = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0];
  const byTime = (a, b) => b.time.localeCompare(a.time);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  const NEWS_CATS = CATEGORIES.filter(c => c.id !== "all" && !c.video);   // 新聞分類（不含首頁與頻道）
  let VIDEOS = [];        // 比特王頻道影片
  let CHANNEL = "https://www.youtube.com/@bitking888";
  let ARTS = [];          // 目前顯示的新聞
  let UPDATED = "";       // 新聞最後更新時間
  let DEMO = false;       // 是否正在顯示備用示範新聞

  /* ---------- 圖片 ---------- */
  function imgUrl(a, small) {
    if (typeof a.img === "number") return `https://picsum.photos/id/${a.img}/${small ? "640/400" : "1400/875"}`;
    if (!a.img) return "";
    if (small && a.img.includes("ettoday.net/images")) return a.img.replace(/\/e(\d+\.\w+)$/, "/d$1");
    return a.img;
  }
  const hasImg = a => !!imgUrl(a);
  function imgTag(a, small, eager) {
    const u = imgUrl(a, small);
    return u ? `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" ${eager ? "" : 'loading="lazy"'} onerror="this.remove()">` : "";
  }
  // 沒有圖片時顯示的分類圖示底圖
  const ph = a => `<span class="ph"><b>${catOf(a.cat).icon}</b><small>${esc(a.source || SITE.name)}</small></span>`;

  /* ---------- 時間 ---------- */
  function ago(t) {
    const d = new Date(t.replace(" ", "T") + "+08:00");
    const m = Math.round((Date.now() - d) / 60000);
    if (m < 1) return "剛剛";
    if (m < 60) return `${m} 分鐘前`;
    if (m < 60 * 24) return `${Math.floor(m / 60)} 小時前`;
    return `${Math.floor(m / 1440)} 天前`;
  }
  const hhmm = t => t.slice(11, 16);

  /* ---------- 共用元件 ---------- */
  const tag = c => `<span class="tag" style="--c:${c.color}">${c.name}</span>`;
  // 留言與流量功能（community.js）載入完成後才執行
  function comm(fn) {
    if (window.BTKCommunity) fn(window.BTKCommunity);
    else window.addEventListener("btk-community-ready", () => fn(window.BTKCommunity), { once: true });
  }
  const meta = a => `<div class="meta"><span class="src">${esc(a.source)}</span><span>${ago(a.time)}</span></div>`;

  function card(a, cls = "") {
    const c = catOf(a.cat);
    return `<article class="card ${cls} fade-in" style="--c:${c.color}" data-id="${a.id}" tabindex="0">
      <div class="thumb">${ph(a)}${imgTag(a, !cls)}${tag(c)}</div>
      <div class="card-body">
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.summary)}</p>
        ${meta(a)}
      </div>
    </article>`;
  }

  function mini(a) {
    const c = catOf(a.cat);
    return `<article class="mini fade-in" style="--c:${c.color}" data-id="${a.id}" tabindex="0">
      <div class="thumb">${ph(a)}${imgTag(a, true)}</div>
      <div><h3>${esc(a.title)}</h3>${meta(a)}</div>
    </article>`;
  }

  const inCat = id => ARTS.filter(a => a.cat === id).sort(byTime);

  function sidebar(excludeCat) {
    // 各類焦點：每個分類挑一則最新的
    const picks = NEWS_CATS.filter(c => c.id !== excludeCat)
      .map(c => inCat(c.id)[1] || inCat(c.id)[0]).filter(Boolean);
    return `<aside class="sidebar">
      <section class="panel"><h3 class="panel-title">各類焦點</h3>
        <ol class="rank">${picks.map(a =>
          `<li><a href="#news/${a.id}"><div><span>${esc(a.title)}</span><small style="color:${catOf(a.cat).color}">${catOf(a.cat).name}・${esc(a.source)}・${ago(a.time)}</small></div></a></li>`
        ).join("")}</ol>
      </section>
      <section class="panel"><h3 class="panel-title">逛逛分類</h3>
        <div class="cat-cloud">${NEWS_CATS.map(c =>
          `<button style="--c:${c.color}" data-cat="${c.id}">${c.icon} ${c.name}</button>`).join("")}</div>
      </section>
      <section class="panel sources"><h3 class="panel-title">新聞來源</h3>
        <p>本站以 <b>聯合報</b> 為主，並彙整 <b>ETtoday</b>、<b>中央社</b>、<b>科技新報</b>、<b>非凡新聞</b>（財經）的公開新聞，每 10 分鐘更新。點進文章可前往原網站閱讀全文。</p>
      </section>
    </aside>`;
  }

  /* ---------- 首頁 ---------- */
  function renderHome() {
    // 輪播：每個分類挑一則最新、有圖的新聞
    const slides = NEWS_CATS.map(c => inCat(c.id).find(hasImg)).filter(Boolean).sort(byTime).slice(0, 8);
    const used = new Set(slides.map(a => a.id));
    const latest = [...ARTS].sort(byTime).slice(0, 12);

    const sections = NEWS_CATS.map(c => {
      const list = inCat(c.id).filter(a => !used.has(a.id));
      if (!list.length) return "";
      const big = list.find(hasImg) || list[0];
      const rest = list.filter(a => a !== big).slice(0, 4);
      return `<section class="section" style="--c:${c.color}">
        <div class="section-head">
          <h2><span class="dot"></span>${c.name}</h2>
          <a class="more" href="#cat/${c.id}">看更多${c.name}新聞 →</a>
        </div>
        <div class="cat-block">
          ${card(big, "big")}
          <div class="mini-list">${rest.map(mini).join("")}</div>
        </div>
      </section>`;
    }).join("");

    $("#main").innerHTML = `
      ${DEMO ? `<div class="notice">⚠ 目前讀不到即時新聞，暫時顯示示範內容。請用「啟動比特王新聞網」開啟網站。</div>` : ""}
      <div class="hero-grid">
        <div class="slider" id="slider" aria-roledescription="輪播" aria-label="焦點新聞">
          ${slides.map((a, i) => {
            const c = catOf(a.cat);
            return `<div class="slide${i === 0 ? " on" : ""}" data-id="${a.id}" aria-hidden="${i !== 0}">
              ${imgTag(a, false, i < 2)}
              <div class="slide-text">${tag(c)}<h2>${esc(a.title)}</h2><p>${esc(a.summary)}</p>
                <div class="slide-src">${esc(a.source)}・${ago(a.time)}</div></div>
            </div>`;
          }).join("")}
          <button class="slider-arrow prev" aria-label="上一則">‹</button>
          <button class="slider-arrow next" aria-label="下一則">›</button>
          <div class="slider-dots">${slides.map((_, i) => `<button aria-label="第 ${i + 1} 則"><span></span></button>`).join("")}</div>
          <div class="slider-count"><b id="slideNo">1</b> / ${slides.length}</div>
        </div>
        <aside class="panel latest">
          <h3 class="panel-title">即時新聞 <span class="live">LIVE</span></h3>
          <ul class="latest-list">${latest.map(a =>
            `<li><a href="#news/${a.id}"><time>${hhmm(a.time)}</time><span>${esc(a.title)}<small style="color:${catOf(a.cat).color}">${catOf(a.cat).name}・${esc(a.source)}</small></span></a></li>`).join("")}</ul>
        </aside>
      </div>
      ${channelSection()}
      ${fbSection()}
      <div class="home-layout">
        <div>${sections}</div>
        ${sidebar()}
      </div>
      ${tvScreen()}`;
    startSlider();
    startChannelRow();
    startTv();
  }

  /* ---------- 輪播橫幅 ---------- */
  let sliderTimer = null;
  function startSlider() {
    const el = $("#slider");
    if (!el) return;
    const slides = [...el.querySelectorAll(".slide")];
    const dots = [...el.querySelectorAll(".slider-dots button")];
    if (!slides.length) return;
    const DUR = 6000; // 每張停留 6 秒
    el.style.setProperty("--dur", DUR + "ms");
    let cur = 0, remaining = DUR, startedAt = 0, paused = false;

    function go(n) {
      cur = (n + slides.length) % slides.length;
      slides.forEach((s, i) => { s.classList.toggle("on", i === cur); s.setAttribute("aria-hidden", i !== cur); });
      dots.forEach((d, i) => { d.classList.remove("on"); d.classList.toggle("done", i < cur); });
      void dots[cur].offsetWidth;            // 讓進度條動畫重新開始
      dots[cur].classList.add("on");
      $("#slideNo").textContent = cur + 1;
      remaining = DUR;
      schedule();
    }
    function schedule() {
      clearTimeout(sliderTimer);
      if (paused) return;
      startedAt = Date.now();
      sliderTimer = setTimeout(() => go(cur + 1), remaining);
    }
    function pause() {
      if (paused) return;
      paused = true; el.classList.add("paused");
      clearTimeout(sliderTimer);
      remaining -= Date.now() - startedAt;
    }
    function resume() {
      if (!paused) return;
      paused = false; el.classList.remove("paused");
      schedule();
    }

    el.querySelector(".prev").onclick = e => { e.stopPropagation(); go(cur - 1); };
    el.querySelector(".next").onclick = e => { e.stopPropagation(); go(cur + 1); };
    dots.forEach((d, i) => d.onclick = e => { e.stopPropagation(); go(i); });
    el.addEventListener("mouseenter", pause);
    el.addEventListener("mouseleave", resume);
    slides.forEach(s => s.onclick = () => openArticle(s.dataset.id));

    // 手機滑動切換
    let x0 = null;
    el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; pause(); }, { passive: true });
    el.addEventListener("touchend", e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      paused = false; el.classList.remove("paused");
      if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1)); else schedule();
      x0 = null;
    });
    document.onvisibilitychange = () => document.hidden ? pause() : resume();

    go(0);
  }

  /* ---------- 比特王頻道 ---------- */
  const thumb = (v, big) => `https://i.ytimg.com/vi/${v.id}/${big ? "maxresdefault" : "hqdefault"}.jpg`;
  const views = n => n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)} 萬次觀看` : `${n || 0} 次觀看`;
  const PLAY = `<span class="play"><svg viewBox="0 0 68 48"><path d="M66.5 7.7c-.8-2.9-3-5.2-5.9-6C55.3.3 34 .3 34 .3S12.7.3 7.4 1.7c-2.9.8-5.1 3.1-5.9 6C.1 13 .1 24 .1 24s0 11 1.4 16.3c.8 2.9 3 5.2 5.9 6C12.7 47.7 34 47.7 34 47.7s21.3 0 26.6-1.4c2.9-.8 5.1-3.1 5.9-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z" fill="#e11d48"/><path d="M45 24 27 14v20z" fill="#fff"/></svg></span>`;

  function vcard(v, big, isNew) {
    return `<article class="vcard${big ? " big" : ""} fade-in" data-vid="${esc(v.id)}" tabindex="0">
      <div class="vthumb"><img src="${thumb(v, big)}" alt="" loading="lazy" referrerpolicy="no-referrer"
        onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${thumb(v, false)}'}">${PLAY}
        ${big || isNew ? `<span class="vnew">最新上傳</span>` : ""}</div>
      <div class="vbody"><h3>${esc(v.title)}</h3>
        <div class="meta"><span class="src">${views(v.views)}</span><span>${ago(v.time)}</span></div></div>
    </article>`;
  }

  function channelSection() {
    if (!VIDEOS.length) return "";
    return `<section class="section channel" style="--c:#1f2b31">
      <div class="section-head">
        <h2><img class="ch-logo" src="logo.png" alt="">比特王頻道</h2>
        <a class="more" href="#cat/channel">看全部影片 →</a>
      </div>
      <div class="ch-row-wrap">
        <button class="ch-arrow prev" aria-label="往左看">‹</button>
        <div class="ch-row" id="chRow">${VIDEOS.map((v, i) => vcard(v, false, i === 0)).join("")}</div>
        <button class="ch-arrow next" aria-label="往右看">›</button>
      </div>
    </section>`;
  }
  // 比特王 Facebook：使用 Facebook 官方的「粉絲專頁外掛程式」顯示最新貼文
  function fbSection() {
    if (typeof FB_PAGE === "undefined") return "";
    return `<section class="section fbsec" style="--c:#1877f2">
      <div class="fb-banner">
        <span class="fb-ico big">f</span>
        <img src="logo.png" alt="比特王">
        <div class="fb-txt"><h3>比特王 Facebook 粉絲專頁</h3>
          <p>政治現場、造勢直擊與深度評論，最新貼文都在粉專，按讚追蹤不漏接！</p></div>
        <a class="fb-btn" href="${esc(FB_PAGE)}" target="_blank" rel="noopener">👍 前往粉專看最新貼文</a>
      </div>
    </section>`;
  }

  // 頻道那一排：左右箭頭一次捲動一個畫面寬，捲到底時把箭頭變淡
  function startChannelRow() {
    const row = $("#chRow");
    if (!row) return;
    const wrap = row.parentElement;
    const step = () => row.clientWidth * 0.9;
    wrap.querySelector(".prev").onclick = () => row.scrollBy({ left: -step(), behavior: "smooth" });
    wrap.querySelector(".next").onclick = () => row.scrollBy({ left: step(), behavior: "smooth" });
    const update = () => {
      wrap.classList.toggle("at-start", row.scrollLeft < 8);
      wrap.classList.toggle("at-end", row.scrollLeft + row.clientWidth > row.scrollWidth - 8);
    };
    row.addEventListener("scroll", update, { passive: true });
    update();
  }

  function renderChannel() {
    $("#main").innerHTML = `
      <div class="cat-hero ch-hero fade-in" style="--c:#1f2b31">
        <img src="logo.png" alt="比特王">
        <div><h1>比特王頻道</h1><p>Bit King 比特王出任務・最新 ${VIDEOS.length} 支影片</p></div>
        <a class="sub-btn" href="${esc(CHANNEL)}?sub_confirmation=1" target="_blank" rel="noopener">▶ 訂閱頻道</a>
      </div>
      ${VIDEOS.length ? `<div class="grid vgrid">${VIDEOS.map((v, i) => vcard(v, i === 0)).join("")}</div>`
        : `<div class="empty"><b>📺</b>影片清單載入中，請稍後再來</div>`}`;
  }

  // 底部大螢幕：捲動到附近才開始播放（靜音）
  function tvScreen() {
    if (!VIDEOS.length) return "";
    const v = VIDEOS[0];
    return `<section class="tv">
      <div class="tv-head"><img src="logo.png" alt=""><div><small>比特王頻道・最新影片</small><h2>${esc(v.title)}</h2></div>
        <a class="sub-btn" href="${esc(CHANNEL)}?sub_confirmation=1" target="_blank" rel="noopener">▶ 訂閱頻道</a></div>
      <div class="tv-frame"><div class="tv-screen" id="tvScreen" data-id="${esc(v.id)}">
        <img src="${thumb(v, true)}" alt="" referrerpolicy="no-referrer" onerror="this.src='${thumb(v, false)}'"></div></div>
      <p class="tv-tip">🔇 影片預設靜音播放，要聽聲音請點畫面上的喇叭圖示。</p>
    </section>`;
  }
  function startTv() {
    const el = $("#tvScreen");
    if (!el) return;
    const load = () => {
      if (el.dataset.on) return;
      el.dataset.on = 1;
      el.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${el.dataset.id}?autoplay=1&mute=1&playsinline=1&rel=0"
        title="比特王頻道最新影片" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { load(); io.disconnect(); } }, { rootMargin: "300px" });
      io.observe(el);
    } else load();
  }

  // 點影片：跳出播放視窗（有聲音）
  function openVideo(id) {
    const v = VIDEOS.find(x => x.id === id);
    if (!v) return;
    $("#vmodalFrame").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&playsinline=1&rel=0"
      title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    $("#vmodalTitle").textContent = v.title;
    $("#vmodalMeta").textContent = `${views(v.views)}・${ago(v.time)}`;
    $("#vmodalLink").href = `https://www.youtube.com/watch?v=${v.id}`;
    $("#vmodal").classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeVideo() {
    $("#vmodal").classList.remove("open");
    $("#vmodalFrame").innerHTML = "";
    if (!$("#reader").classList.contains("open")) document.body.style.overflow = "";
  }

  /* ---------- 分類頁 ---------- */
  const CAT_DESC = {
    politics: "政策動向、國會攻防與選舉焦點", society: "社會事件與治安動態", world: "掌握全球大事與國際脈動",
    finance: "股市、理財與產業最新趨勢", tech: "AI、半導體與數位生活新知",
    life: "天氣、交通、消費與日常大小事", health: "醫療新知與養生保健",
    sports: "賽場上的熱血與感動", ent: "影視、音樂與明星動態", travel: "國內外旅遊情報與玩樂提案",
  };
  function renderCategory(id) {
    const c = catOf(id);
    const list = inCat(id);
    const first = list.find(hasImg);
    const ordered = first ? [first, ...list.filter(a => a !== first)] : list;
    $("#main").innerHTML = `
      <div class="cat-hero fade-in" style="--c:${c.color}" data-icon="${c.icon}">
        <h1>${c.name}</h1><p>${CAT_DESC[id] || ""}・共 ${list.length} 則新聞</p>
      </div>
      <div class="home-layout">
        <div class="grid">${ordered.map((a, i) => card(a, i === 0 ? "feature" : "")).join("") ||
          `<div class="empty"><b>📭</b>這個分類目前還沒有新聞</div>`}</div>
        ${sidebar(id)}
      </div>`;
  }

  /* ---------- 搜尋 ---------- */
  function renderSearch(q) {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = ARTS.filter(a => {
      const text = (a.title + a.summary + catOf(a.cat).name + a.source).toLowerCase();
      return words.every(w => text.includes(w));
    }).sort(byTime);
    $("#searchInput").value = q;
    $("#main").innerHTML = `
      <div class="cat-hero fade-in" style="--c:#334155" data-icon="🔍">
        <h1>搜尋：「${esc(q)}」</h1><p>找到 ${list.length} 則相關新聞</p>
      </div>
      <div class="grid">${list.map(a => card(a)).join("") ||
        `<div class="empty" style="grid-column:1/-1"><b>🔍</b>找不到相關新聞，換個關鍵字試試看</div>`}</div>`;
  }

  /* ---------- 閱讀文章 ---------- */
  let lastNonArticleHash = "";
  let openedInSite = false;
  function openArticle(id) {
    id = String(id);
    if (location.hash !== `#news/${id}`) { openedInSite = true; location.hash = `news/${id}`; return; }
    const a = ARTS.find(x => String(x.id) === id);
    if (!a) { location.hash = ""; return; }
    const c = catOf(a.cat);
    const related = inCat(a.cat).filter(x => x.id !== a.id).slice(0, 6);
    $("#readerArticle").style.setProperty("--c", c.color);
    $("#readerArticle").innerHTML = `
      ${tag(c)}
      <h1>${esc(a.title)}</h1>
      <div class="reader-meta"><span>來源 <b>${esc(a.source)}</b></span><span>${a.time.replace(/-/g, "/")}</span><span>${ago(a.time)}</span></div>
      ${hasImg(a) ? `<figure class="reader-cover">${imgTag(a, false, true)}</figure>
      <div class="reader-caption">圖片來源：${esc(a.source)}</div>` : `<div style="height:28px"></div>`}
      <p class="reader-lead">${esc(a.summary)}</p>
      ${a.link ? `<a class="read-full" href="${esc(a.link)}" target="_blank" rel="noopener">
          <span><small>完整報導請至</small>${esc(a.source)} 閱讀全文</span><b>↗</b></a>` : ""}
      <div class="reader-share">
        <button data-share="copy">🔗 複製這篇的連結</button>
      </div>
      <div class="reader-note">※ 比特王新聞網自動彙整各大媒體公開的新聞摘要，文章版權屬原媒體所有。</div>
      <section class="comments section" id="comments" style="--c:${c.color}"></section>
      ${related.length ? `<section class="related section" style="--c:${c.color}">
        <div class="section-head"><h2><span class="dot"></span>更多${c.name}新聞</h2></div>
        <div class="grid">${related.map(x => card(x)).join("")}</div></section>` : ""}`;
    document.title = `${a.title}｜${SITE.name}`;
    comm(m => { m.mountComments(a); m.trackView(a); });
    const r = $("#reader");
    r.classList.add("open"); r.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    $("#readerScroll").scrollTop = 0;
    updateProgress();
    setTimeout(() => $("#readerClose").focus({ preventScroll: true }), 50);
  }
  function closeReader() {
    const r = $("#reader");
    if (r.classList.contains("open")) comm(m => m.unmountComments());
    r.classList.remove("open"); r.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    document.title = `${SITE.name}｜${SITE.slogan}`;
  }
  function updateProgress() {
    const s = $("#readerScroll");
    const max = s.scrollHeight - s.clientHeight;
    $("#readProgress").style.width = (max > 0 ? (s.scrollTop / max) * 100 : 0) + "%";
  }

  /* ---------- 網址切換 ---------- */
  let currentView = null;
  function route(force) {
    const h = decodeURIComponent(location.hash.slice(1));
    const [type, ...rest] = h.split("/");
    const arg = rest.join("/");

    if (type === "news") {
      if (currentView === null) { currentView = "home"; renderHome(); setActive("all"); }
      openArticle(arg);
      return;
    }
    closeReader();
    openedInSite = false;
    lastNonArticleHash = location.hash;
    clearTimeout(sliderTimer);
    const view = h || "home";
    if (view === currentView && force !== true) return;
    const keepScroll = force === true;
    currentView = view;

    if (type === "cat" && arg === "channel") {
      renderChannel(); setActive("channel");
    } else if (type === "cat" && CATEGORIES.some(c => c.id === arg && arg !== "all")) {
      renderCategory(arg); setActive(arg);
    } else if (type === "search" && arg) {
      renderSearch(arg); setActive(null);
    } else {
      renderHome(); setActive("all");
    }
    if (!keepScroll) window.scrollTo({ top: 0, behavior: "instant" });
    if (!keepScroll) comm(m => m.trackView(null));
  }

  function setActive(id) {
    document.querySelectorAll(".cat-pill").forEach(p => {
      const on = p.dataset.cat === id;
      p.classList.toggle("active", on);
      if (on) p.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    });
  }

  /* ---------- 讀取新聞 ---------- */
  async function loadNews() {
    const r = await fetch("news.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    if (!d.articles?.length) throw new Error("empty");
    return d;
  }
  function useData(d) {
    ARTS = d.articles; UPDATED = d.updated; DEMO = false;
    VIDEOS = d.videos || []; if (d.channel) CHANNEL = d.channel;
    $("#updated").textContent = `新聞更新於 ${UPDATED.slice(11, 16)}`;
    paintTicker();
  }
  function useDemo() {
    ARTS = ARTICLES.map(a => ({ ...a, id: String(a.id), source: a.author }));
    DEMO = true;
    $("#updated").textContent = "示範內容";
    paintTicker();
  }
  function paintTicker() {
    const news = [...ARTS].sort(byTime).slice(0, 12);
    const ads = (typeof TICKER_ADS !== "undefined" ? TICKER_ADS : []);
    const parts = [];
    news.forEach((a, i) => {
      parts.push(`<a href="#news/${a.id}">${esc(a.title)}</a>`);
      if (ads.length && i % 3 === 2) {          // 每 3 則新聞插 1 則廣告
        const ad = ads[Math.floor(i / 3) % ads.length];
        parts.push(`<a class="tk-ad" href="${esc(ad.url)}" target="_blank" rel="noopener sponsored"><b>台光 APP</b>${esc(ad.text)}</a>`);
      }
    });
    const el = $("#ticker");
    el.innerHTML = parts.join("") + parts.join("");   // 複製兩份才能無縫循環
    // 固定的慢速：每秒移動約 45 像素（不論內容多長，速度都一樣）
    const dist = el.scrollWidth / 2;
    if (dist > 0) el.style.animationDuration = Math.max(60, dist / 45) + "s";
  }

  // 每 3 分鐘檢查有沒有新新聞，有的話跳出提示
  let pending = null;
  async function checkUpdate() {
    try {
      const d = await loadNews();
      if (DEMO) { useData(d); route(true); return; }
      if (d.updated === UPDATED) return;
      const old = new Set(ARTS.map(a => a.id));
      const n = d.articles.filter(a => !old.has(a.id)).length;
      if (!n) { useData(d); return; }
      pending = d;
      $("#toastText").textContent = `有 ${n} 則新新聞`;
      $("#toast").classList.add("show");
    } catch (e) {}
  }
  function applyPending() {
    if (!pending) return;
    useData(pending); pending = null;
    $("#toast").classList.remove("show");
    if (!$("#reader").classList.contains("open")) route(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- 啟動 ---------- */
  async function init() {
    const d = new Date();
    $("#today").textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日　星期${"日一二三四五六"[d.getDay()]}`;

    $("#catList").innerHTML = CATEGORIES.map(c =>
      `<a class="cat-pill" style="--c:${c.color}" data-cat="${c.id}" href="${c.id === "all" ? "#" : "#cat/" + c.id}">
        <span class="ic">${c.icon}</span>${c.name}</a>`).join("");
    $("#footerCats").innerHTML = NEWS_CATS.map(c => `<a href="#cat/${c.id}">${c.name}</a>`).join("");

    document.addEventListener("click", e => {
      const catBtn = e.target.closest("[data-cat]:not(a)");
      if (catBtn) { location.hash = `cat/${catBtn.dataset.cat}`; return; }
      const vc = e.target.closest("[data-vid]");
      if (vc) { openVideo(vc.dataset.vid); return; }
      if (e.target.closest("#vmodalClose") || e.target.id === "vmodal") { closeVideo(); return; }
      const el = e.target.closest(".card[data-id], .mini[data-id]");
      if (el) openArticle(el.dataset.id);
      const share = e.target.closest("[data-share]");
      if (share) {
        navigator.clipboard?.writeText(location.href).then(() => {
          share.textContent = "✓ 已複製"; setTimeout(() => share.textContent = "🔗 複製這篇的連結", 1500);
        }).catch(() => {});
      }
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Enter" && e.target.matches(".card[data-id], .mini[data-id]")) openArticle(e.target.dataset.id);
      if (e.key === "Enter" && e.target.matches("[data-vid]")) openVideo(e.target.dataset.vid);
      if (e.key === "Escape" && $("#vmodal").classList.contains("open")) { closeVideo(); return; }
      if (e.key === "Escape" && $("#reader").classList.contains("open")) $("#readerClose").click();
    });

    $("#searchForm").addEventListener("submit", e => {
      e.preventDefault();
      const q = $("#searchInput").value.trim();
      if (q) location.hash = `search/${encodeURIComponent(q)}`;
    });

    $("#readerClose").onclick = () => {
      if (openedInSite) history.back();
      else location.hash = lastNonArticleHash || "";
    };
    $("#readerScroll").addEventListener("scroll", updateProgress, { passive: true });

    const setFont = delta => {
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--read-size")) || 19;
      const next = Math.min(28, Math.max(15, cur + delta));
      document.documentElement.style.setProperty("--read-size", next + "px");
      try { localStorage.setItem("btk-font", next); } catch (e) {}
    };
    $("#fontUp").onclick = () => setFont(2);
    $("#fontDown").onclick = () => setFont(-2);

    const themeBtn = $("#themeBtn");
    const isDark = () => {
      const t = document.documentElement.dataset.theme;
      return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    };
    const paintTheme = () => themeBtn.textContent = isDark() ? "☀️ 淺色模式" : "🌙 深色模式";
    themeBtn.onclick = () => {
      const t = isDark() ? "light" : "dark";
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem("btk-theme", t); } catch (e) {}
      paintTheme();
    };
    paintTheme();

    const nav = $("#catnav"), toTop = $("#toTop");
    window.addEventListener("scroll", () => {
      nav.classList.toggle("scrolled", window.scrollY > 160);
      toTop.classList.toggle("show", window.scrollY > 600);
    }, { passive: true });
    toTop.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
    $("#toast").onclick = applyPending;

    try { useData(await loadNews()); } catch (e) { useDemo(); }

    window.addEventListener("hashchange", route);
    route();
    setInterval(checkUpdate, 3 * 60 * 1000);
  }

  init();
})();
