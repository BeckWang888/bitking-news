/* ============================================================
   比特王新聞網 — 輿情分析頁面（資料來自 pulse.json，每次新聞更新時重新計算）
   ============================================================ */
(() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const CAMP = {
    blue:  { name: "藍營", party: "國民黨" },
    green: { name: "綠營", party: "民進黨" },
    white: { name: "白營", party: "民眾黨" },
    intl:  { name: "國際人物", party: "" },
  };
  const store = (k, v) => { try { v === undefined ? (v = localStorage.getItem(k)) : localStorage.setItem(k, v); } catch (e) {} return v; };

  // 新聞連結：網站上有的開站內文章，沒有的開原始媒體
  const newsLink = c => c.onsite ? `href="#news/${esc(c.id)}"` : `href="${esc(c.link)}" target="_blank" rel="noopener"`;

  // 排行清單（附熱度長條）
  function rankList(list, colorVar) {
    if (!list || !list.length) return `<p class="pv-empty">目前資料不足，稍後再來看看</p>`;
    return `<ol class="pv-rank">${list.map((c, i) => `
      <li>
        <span class="pv-no${i < 3 ? " top" : ""}">${i + 1}</span>
        <div class="pv-item">
          <a ${newsLink(c)}>${esc(c.title)}</a>
          <div class="pv-meta">${c.count} 則報導・${c.sources.length} 家媒體（${esc(c.sources.slice(0, 3).join("、"))}${c.sources.length > 3 ? "…" : ""}）</div>
          <div class="pv-bar" title="熱度 ${c.score}：${c.count} 則報導、${c.sources.length} 家媒體">
            <span style="width:${Math.max(4, c.score)}%;background:var(${colorVar})"></span><b>${c.score}</b>
          </div>
        </div>
      </li>`).join("")}</ol>`;
  }

  // 橫向長條圖（聲量）
  function hbars(list, colorFn, unit = "則") {
    if (!list || !list.length) return `<p class="pv-empty">目前資料不足</p>`;
    const max = Math.max(...list.map(x => x.count));
    return `<div class="pv-hbars">${list.map(x => `
      <div class="pv-hrow" title="${esc(x.name)}：${x.count} ${unit}新聞提及">
        <span class="pv-hlabel">${esc(x.name)}</span>
        <span class="pv-htrack"><span style="width:${Math.max(3, x.count / max * 100)}%;background:${colorFn(x)}"></span></span>
        <span class="pv-hval">${x.count}</span>
      </div>`).join("")}</div>`;
  }
  const campColor = camp => `var(--camp-${camp})`;

  // 文字雲：字越大＝聲量越高；顏色＝陣營
  function cloud(people) {
    if (!people.length) return `<p class="pv-empty">目前資料不足</p>`;
    const max = Math.max(...people.map(p => p.count));
    const sorted = [...people].sort((a, b) => b.count - a.count).slice(0, 36);
    const arranged = [];                      // 大的放中間，小的往兩邊
    sorted.forEach((p, i) => (i % 2 ? arranged.push(p) : arranged.unshift(p)));
    return `<div class="pv-cloud">${arranged.map(p => {
      const size = 14 + Math.sqrt(p.count / max) * 44;
      return `<span style="font-size:${size.toFixed(0)}px;color:${campColor(p.camp)}" title="${esc(p.name)}（${CAMP[p.camp].name}）：${p.count} 則新聞提及">${esc(p.name)}</span>`;
    }).join("")}</div>`;
  }

  // 陣營聲量比例（甜甜圈圖）
  function donut(share) {
    const parts = ["blue", "green", "white"].map(k => ({ k, v: share[k] || 0 }));
    const total = parts.reduce((s, p) => s + p.v, 0);
    if (!total) return `<p class="pv-empty">目前資料不足</p>`;
    const R = 80, C = 2 * Math.PI * R;
    let off = 0;
    const segs = parts.filter(p => p.v).map(p => {
      const len = p.v / total * C;
      const gap = parts.filter(x => x.v).length > 1 ? 2 : 0;
      const s = `<circle r="${R}" cx="100" cy="100" fill="none" stroke="${campColor(p.k)}" stroke-width="30"
        stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)">
        <title>${CAMP[p.k].name}：${p.v} 次提及（${Math.round(p.v / total * 100)}%）</title></circle>`;
      off += len;
      return s;
    }).join("");
    return `<div class="pv-donut-wrap">
      <svg viewBox="0 0 200 200" class="pv-donut" role="img" aria-label="藍綠白陣營人物聲量比例">
        ${segs}
        <text x="100" y="96" text-anchor="middle" class="pv-donut-num">${total}</text>
        <text x="100" y="118" text-anchor="middle" class="pv-donut-cap">次提及</text>
      </svg>
      <table class="pv-donut-table">
        <thead><tr><th>陣營</th><th>提及次數</th><th>比例</th></tr></thead>
        <tbody>${parts.map(p => `<tr><td><i style="background:${campColor(p.k)}"></i>${CAMP[p.k].name}（${CAMP[p.k].party}）</td>
          <td>${p.v}</td><td>${Math.round(p.v / total * 100)}%</td></tr>`).join("")}</tbody>
      </table>
    </div>`;
  }

  function legend() {
    return `<div class="pv-legend">${Object.entries(CAMP).map(([k, c]) =>
      `<span><i style="background:${campColor(k)}"></i>${c.name}</span>`).join("")}</div>`;
  }

  function card(title, sub, body, cls = "") {
    return `<section class="pv-card ${cls}"><div class="pv-card-head"><h3>${title}</h3>${sub ? `<small>${sub}</small>` : ""}</div>${body}</section>`;
  }

  function draw(main, d) {
    const tab = store("btk-pulse-tab") || "rank";
    const view = store("btk-pulse-people") || "cloud";
    main.innerHTML = `
      <div class="cat-hero pv-hero fade-in" style="--c:#312e81" data-icon="📊">
        <h1>輿情分析</h1>
        <p>統計範圍：過去 24 小時・共分析 ${d.total} 則新聞・${d.sources.length} 家媒體・更新於 ${esc(d.updated.slice(5).replace("-", "/"))}</p>
      </div>
      <div class="pv-tabs" role="tablist">
        <button role="tab" data-tab="rank" class="${tab === "rank" ? "on" : ""}">🏆 今日新聞排行榜</button>
        <button role="tab" data-tab="heat" class="${tab === "heat" ? "on" : ""}">🔥 今日風向熱度</button>
      </div>

      <div class="pv-panel" data-panel="rank" ${tab === "rank" ? "" : "hidden"}>
        <p class="pv-intro">依「同一件事被幾則新聞、幾家媒體報導」計算熱度，三個陣營各列前 10 名。點標題可閱讀新聞。</p>
        <div class="pv-camps">
          ${["blue", "green", "white"].map(k => `
            <section class="pv-camp" style="--cc:var(--camp-${k})">
              <h3><i></i>${CAMP[k].name}<small>${CAMP[k].party}相關新聞</small></h3>
              ${rankList(d.camps[k], `--camp-${k}`)}
            </section>`).join("")}
        </div>
      </div>

      <div class="pv-panel" data-panel="heat" ${tab === "heat" ? "" : "hidden"}>
        ${card("👥 政治人物聲量", "被多少則新聞提到", `
          <div class="pv-switch" role="tablist">
            <button data-view="cloud" class="${view === "cloud" ? "on" : ""}">文字雲</button>
            <button data-view="bars" class="${view === "bars" ? "on" : ""}">排行</button>
            <button data-view="share" class="${view === "share" ? "on" : ""}">陣營比例</button>
          </div>
          ${legend()}
          <div data-pview="cloud" ${view === "cloud" ? "" : "hidden"}>${cloud(d.people)}</div>
          <div data-pview="bars" ${view === "bars" ? "" : "hidden"}>${hbars(d.people.slice(0, 15), x => campColor(x.camp))}</div>
          <div data-pview="share" ${view === "share" ? "" : "hidden"}>${donut(d.campShare)}</div>`, "wide")}
        <div class="pv-grid">
          ${card("🏛 政治議題熱度", "相關新聞則數", hbars(d.issues, () => "var(--pv-issue)"))}
          ${card("📰 台灣新聞熱度", "報導越多越熱", rankList(d.taiwan, "--pv-tw"))}
          ${card("🌏 國際事件熱度", "報導越多越熱", rankList(d.world, "--pv-world"))}
          ${card("🤖 AI 事件熱度", "標題提到 AI 相關", rankList(d.ai, "--pv-ai"))}
          ${card("💵 美股公司聲量", "被多少則新聞提到", hbars(d.usStocks, () => "var(--pv-us)"))}
          ${card("📈 台股公司聲量", "被多少則新聞提到", hbars(d.twStocks, () => "var(--pv-twstock)"))}
        </div>
      </div>
      <p class="pv-note">※ 本頁依比特王新聞網收錄的 ${esc(d.sources.join("、"))} 新聞自動統計。「聲量」是被新聞提及的次數，「熱度」是被報導的多寡，不代表民調或支持度。</p>`;

    main.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => {
      main.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("on", x === b));
      main.querySelectorAll("[data-panel]").forEach(p => p.hidden = p.dataset.panel !== b.dataset.tab);
      store("btk-pulse-tab", b.dataset.tab);
    });
    main.querySelectorAll("[data-view]").forEach(b => b.onclick = () => {
      main.querySelectorAll("[data-view]").forEach(x => x.classList.toggle("on", x === b));
      main.querySelectorAll("[data-pview]").forEach(p => p.hidden = p.dataset.pview !== b.dataset.view);
      store("btk-pulse-people", b.dataset.view);
    });
  }

  let cache = null;
  async function render(main) {
    main.innerHTML = `<div class="empty"><b>📊</b>輿情資料載入中…</div>`;
    try {
      if (!cache || Date.now() - cache.at > 5 * 60e3) {
        const r = await fetch("pulse.json?t=" + Date.now(), { cache: "no-store" });
        cache = { at: Date.now(), d: await r.json() };
      }
      draw(main, cache.d);
    } catch (e) {
      main.innerHTML = `<div class="empty"><b>📊</b>輿情資料暫時讀不到，請稍後再試</div>`;
    }
  }
  window.BTKPulse = { render };
})();
