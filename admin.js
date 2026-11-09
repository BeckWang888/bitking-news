/* 比特王新聞網 — 後台：流量統計與留言管理（只有站長帳號讀得到資料） */
import { firebaseConfig, SDK } from "./firebase-config.js";
const { initializeApp } = await import(`${SDK}/firebase-app.js`);
const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } = await import(`${SDK}/firebase-auth.js`);
const { getFirestore, collection, doc, getDocs, deleteDoc, query, where, orderBy, limit, documentId, getCountFromServer }
  = await import(`${SDK}/firebase-firestore.js`);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const CAT = { politics: "政治", society: "社會", world: "國際", finance: "財經", tech: "科技", life: "生活", health: "健康", sports: "體育", ent: "娛樂", travel: "旅遊" };
const fmt = n => Number(n || 0).toLocaleString("zh-TW");

function dayStr(offset) {
  return new Date(Date.now() + 8 * 3600e3 - offset * 864e5).toISOString().slice(0, 10);
}

function loginView(msg) {
  $app.innerHTML = `<div class="center">
    <h2>站長後台</h2><p>${msg || "請用站長的 Google 帳號登入，查看網站流量與管理留言。"}</p>
    <button class="gbtn" id="login">用 Google 帳號登入</button></div>`;
  document.getElementById("login").onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => {
    if (e.code !== "auth/popup-closed-by-user") alert("登入失敗：" + e.code);
  });
}

async function dashboard() {
  $app.innerHTML = `<div class="center"><p>讀取數據中…</p></div>`;
  const DAYS = 30;
  const days = Array.from({ length: DAYS }, (_, i) => dayStr(DAYS - 1 - i));

  // 每日瀏覽次數
  const pvSnap = await getDocs(query(collection(db, "pv"), where(documentId(), ">=", days[0])));
  const views = Object.fromEntries(pvSnap.docs.map(d => [d.id, d.data().views || 0]));
  // 每日不重複訪客（每天各算一次）
  const visitors = {};
  await Promise.all(days.map(async d => {
    const c = await getCountFromServer(query(collection(db, "visitors"), where("day", "==", d)));
    visitors[d] = c.data().count;
  }));
  const sum = (obj, list) => list.reduce((s, d) => s + (obj[d] || 0), 0);
  const last7 = days.slice(-7);
  const today = days[DAYS - 1];
  const totalPv = pvSnap.docs.reduce((s, d) => s + (d.data().views || 0), 0);

  // 熱門文章
  const artSnap = await getDocs(query(collection(db, "articles"), orderBy("views", "desc"), limit(20)));
  // 最新留言
  const cmSnap = await getDocs(query(collection(db, "comments"), orderBy("createdAt", "desc"), limit(30)));
  const cmCount = (await getCountFromServer(collection(db, "comments"))).data().count;

  const max = Math.max(1, ...days.map(d => Math.max(views[d] || 0, visitors[d] || 0)));
  $app.innerHTML = `
    <div class="tiles">
      <div class="tile"><small>今天瀏覽次數</small><b>${fmt(views[today])}</b><span>每開一個頁面算一次</span></div>
      <div class="tile"><small>今天訪客人數</small><b>${fmt(visitors[today])}</b><span>同一台裝置一天只算一人</span></div>
      <div class="tile"><small>近 7 天瀏覽 / 訪客</small><b>${fmt(sum(views, last7))}</b><span>訪客 ${fmt(sum(visitors, last7))} 人次</span></div>
      <div class="tile"><small>近 30 天瀏覽 / 留言總數</small><b>${fmt(totalPv)}</b><span>累計留言 ${fmt(cmCount)} 則</span></div>
    </div>
    <div class="card">
      <h2>近 30 天流量 <span class="legend"><span><i style="background:var(--a)"></i>瀏覽次數</span><span><i style="background:var(--b)"></i>訪客人數</span></span></h2>
      <div class="chart">${days.map(d => `<div class="col" data-tip="${d.slice(5)}　瀏覽 ${views[d] || 0}・訪客 ${visitors[d] || 0}">
        <div class="bar v" style="height:${(views[d] || 0) / max * 100}%"></div>
        <div class="bar u" style="height:${(visitors[d] || 0) / max * 100}%"></div></div>`).join("")}</div>
      <div class="xaxis">${days.map((d, i) => `<span>${i % 5 === 4 || i === DAYS - 1 ? d.slice(5).replace("-", "/") : ""}</span>`).join("")}</div>
    </div>
    <div class="grid2">
      <div class="card"><h2>最多人點閱的新聞</h2>
        ${artSnap.empty ? `<p class="muted">還沒有資料</p>` : `<table><tr><th>標題</th><th>分類</th><th style="text-align:right">點閱</th></tr>
        ${artSnap.docs.map(d => { const a = d.data(); return `<tr><td><a href="./#news/${esc(d.id)}" target="_blank">${esc(a.title)}</a>
          <div class="muted" style="font-size:12px">${esc(a.source)}</div></td><td>${esc(CAT[a.cat] || a.cat)}</td><td class="n">${fmt(a.views)}</td></tr>`; }).join("")}</table>`}
      </div>
      <div class="card"><h2>最新留言</h2>
        ${cmSnap.empty ? `<p class="muted">還沒有留言</p>` : cmSnap.docs.map(d => { const c = d.data(); return `<div class="cm">
          <img src="${esc(c.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
          <div class="t"><b>${esc(c.name)}</b> <small>${c.createdAt ? c.createdAt.toDate().toLocaleString("zh-TW") : ""}・<a href="./#news/${esc(c.articleId)}" target="_blank">看文章</a></small>
            <p>${esc(c.text)}</p></div>
          <button data-del="${d.id}">刪除</button></div>`; }).join("")}
      </div>
    </div>
    <p class="muted" style="margin-top:20px;font-size:13px">說明：在自己電腦上（localhost）測試時不會計入流量。數據每次重新整理此頁面時更新。</p>`;

  $app.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("確定刪除這則留言？刪除後無法復原。")) return;
    await deleteDoc(doc(db, "comments", b.dataset.del));
    b.closest(".cm").remove();
  });
}

const logout = document.getElementById("logout");
logout.onclick = () => signOut(auth);
onAuthStateChanged(auth, async u => {
  logout.hidden = !u;
  if (!u) return loginView();
  try { await dashboard(); }
  catch (e) {
    console.warn(e);
    if (e.code === "permission-denied") loginView(`這個帳號（${esc(u.email)}）沒有後台權限，請改用站長帳號登入。`);
    else $app.innerHTML = `<div class="center"><p>數據讀取失敗：${esc(e.message)}</p></div>`;
  }
});
