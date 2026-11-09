/* ============================================================
   比特王新聞網 — 網友留言（Google 帳號登入）＋ 流量記錄
   ============================================================ */
import { firebaseConfig, SDK } from "./firebase-config.js";
const { initializeApp } = await import(`${SDK}/firebase-app.js`);
const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } = await import(`${SDK}/firebase-auth.js`);
const {
  getFirestore, collection, doc, addDoc, deleteDoc, setDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, increment,
} = await import(`${SDK}/firebase-firestore.js`);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let user = null;
let unsub = null;
let current = null;

const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
function ago(d) {
  if (!d) return "剛剛";
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  if (m < 1440) return `${Math.floor(m / 60)} 小時前`;
  if (m < 43200) return `${Math.floor(m / 1440)} 天前`;
  return d.toLocaleDateString("zh-TW");
}

/* ---------- 留言區 ---------- */
function formHtml() {
  if (!user) {
    return `<button class="google-btn" data-act="login">
      <svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      用 Google 帳號登入後留言</button>
      <p class="cm-hint">登入只會使用你的名字與大頭貼顯示在留言旁。</p>`;
  }
  return `<form class="cm-form" data-act="form">
      <img class="cm-avatar" src="${esc(user.photoURL || "")}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div class="cm-box">
        <textarea maxlength="500" rows="3" placeholder="分享你對這則新聞的看法…（請理性發言）" required></textarea>
        <div class="cm-row">
          <span class="cm-who">${esc(user.displayName || "網友")}・<a href="#" data-act="logout">登出</a></span>
          <span class="cm-count">0 / 500</span>
          <button type="submit">送出留言</button>
        </div>
      </div>
    </form>`;
}

function listHtml(items) {
  if (!items.length) return `<p class="cm-empty">還沒有人留言，來當第一個吧！</p>`;
  return items.map(c => {
    const mine = user && c.uid === user.uid;
    return `<div class="cm-item">
      <img class="cm-avatar" src="${esc(c.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div class="cm-body">
        <div class="cm-head"><b>${esc(c.name)}</b><span>${ago(c.createdAt?.toDate?.())}</span>
          ${mine ? `<button class="cm-del" data-act="del" data-id="${c.id}">刪除</button>` : ""}</div>
        <p>${esc(c.text).replace(/\n/g, "<br>")}</p>
      </div>
    </div>`;
  }).join("");
}

function render(root, items) {
  root.innerHTML = `
    <div class="section-head"><h2><span class="dot"></span>網友留言 <small class="cm-total">${items ? items.length : ""}</small></h2></div>
    <div class="cm-form-wrap">${formHtml()}</div>
    <div class="cm-list">${items ? listHtml(items) : `<p class="cm-empty">留言載入中…</p>`}</div>`;
}

let lastItems = null;
function mountComments(article) {
  const root = document.getElementById("comments");
  if (!root) return;
  current = article;
  if (unsub) unsub();
  lastItems = null;
  render(root, null);
  const q = query(collection(db, "comments"), where("articleId", "==", String(article.id)), orderBy("createdAt", "desc"), limit(200));
  unsub = onSnapshot(q, snap => {
    lastItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (current === article) render(root, lastItems);
  }, err => {
    console.warn("留言讀取失敗", err);
    root.querySelector(".cm-list").innerHTML = `<p class="cm-empty">留言暫時無法載入，請稍後再試。</p>`;
  });
}
function unmountComments() { if (unsub) unsub(); unsub = null; current = null; }

document.addEventListener("click", async e => {
  const el = e.target.closest("#comments [data-act]");
  if (!el || el.tagName === "FORM") return;
  const act = el.dataset.act;
  if (act === "login") {
    e.preventDefault();
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (err) { if (err.code !== "auth/popup-closed-by-user") alert("登入失敗，請再試一次。（" + err.code + "）"); }
  } else if (act === "logout") {
    e.preventDefault(); signOut(auth);
  } else if (act === "del") {
    if (confirm("確定要刪除這則留言嗎？")) {
      try { await deleteDoc(doc(db, "comments", el.dataset.id)); } catch (err) { alert("刪除失敗"); }
    }
  }
});
document.addEventListener("input", e => {
  if (e.target.matches("#comments textarea")) {
    e.target.closest("form").querySelector(".cm-count").textContent = `${e.target.value.length} / 500`;
  }
});
document.addEventListener("submit", async e => {
  const form = e.target.closest("#comments form");
  if (!form) return;
  e.preventDefault();
  const ta = form.querySelector("textarea"), btn = form.querySelector("button");
  const text = ta.value.trim();
  if (!text || !user || !current) return;
  btn.disabled = true; btn.textContent = "送出中…";
  try {
    await addDoc(collection(db, "comments"), {
      articleId: String(current.id), text: text.slice(0, 500), uid: user.uid,
      name: (user.displayName || "網友").slice(0, 60), photo: (user.photoURL || "").slice(0, 500),
      createdAt: serverTimestamp(),
    });
    ta.value = "";
    form.querySelector(".cm-count").textContent = "0 / 500";
  } catch (err) {
    console.warn(err); alert("留言送出失敗，請稍後再試。");
  }
  btn.disabled = false; btn.textContent = "送出留言";
});

onAuthStateChanged(auth, u => {
  user = u;
  const root = document.getElementById("comments");
  if (root && current) render(root, lastItems);
});

/* ---------- 流量記錄（只寫入，數據只有站長在後台看得到） ---------- */
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
let trackLocal = false;
try { trackLocal = localStorage.getItem("btk-track-local") === "1"; } catch (e) {}
const TRACK = !isLocal || trackLocal;   // 自己在電腦上測試時不算流量

function today() {
  const d = new Date(Date.now() + 8 * 3600e3);       // 以台灣時間計算日期
  return d.toISOString().slice(0, 10);
}
function visitorId() {
  try {
    let v = localStorage.getItem("btk-vid");
    if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("btk-vid", v); }
    return v;
  } catch (e) { return "anon" + Math.random().toString(36).slice(2); }
}
async function trackView(article) {
  if (!TRACK) return;
  const day = today();
  try {
    await setDoc(doc(db, "pv", day), { views: increment(1) }, { merge: true });
    let seen = null;
    try { seen = localStorage.getItem("btk-seen"); } catch (e) {}
    if (seen !== day) {
      await setDoc(doc(db, "visitors", `${day}_${visitorId()}`), { day }).catch(() => {});
      try { localStorage.setItem("btk-seen", day); } catch (e) {}
    }
    if (article) {
      await setDoc(doc(db, "articles", String(article.id)), {
        views: increment(1), title: String(article.title).slice(0, 200),
        cat: String(article.cat).slice(0, 20), source: String(article.source || "").slice(0, 20),
      }, { merge: true });
    }
  } catch (e) { console.warn("流量記錄失敗", e); }
}

window.BTKCommunity = { mountComments, unmountComments, trackView };
window.dispatchEvent(new Event("btk-community-ready"));
