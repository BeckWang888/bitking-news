/* 比特王新聞網 — 後台：原創文章的發布、編輯、刪除 */
const CATS = [
  ["politics", "政治"], ["society", "社會"], ["world", "國際"], ["finance", "財經"], ["tech", "科技"],
  ["life", "生活"], ["health", "健康"], ["sports", "體育"], ["ent", "娛樂"], ["travel", "旅遊"],
];
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

// 把照片縮小成網頁用的大小（最寬 1280 像素），避免檔案太大
function shrinkImage(file, maxW = 1280, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = quality, data = c.toDataURL("image/jpeg", q);
      while (data.length > 850000 && q > 0.4) { q -= 0.1; data = c.toDataURL("image/jpeg", q); }
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("照片讀取失敗")); };
    img.src = url;
  });
}

export function initPosts(root, fb) {
  const { db, collection, doc, getDocs, addDoc, setDoc, deleteDoc, query, orderBy, serverTimestamp } = fb;
  let editing = null;      // 正在編輯的文章編號（null 表示新文章）
  let imgData = "";

  root.innerHTML = `
    <div class="card">
      <h2 id="pfTitle">✍ 發布新文章</h2>
      <form id="postForm" class="pform">
        <label>標題<input id="pTitle" maxlength="200" required placeholder="例如：洋流退場後，台中選情怎麼走？"></label>
        <div class="prow">
          <label>分類<select id="pCat">${CATS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select></label>
          <label>作者<input id="pAuthor" maxlength="60" value="比特王新聞網"></label>
        </div>
        <label>摘要（顯示在卡片和文章開頭，可留白）<textarea id="pSummary" rows="2" maxlength="400" placeholder="用一兩句話說明這篇文章重點"></textarea></label>
        <label>封面照片（可不放）<input id="pImg" type="file" accept="image/*"></label>
        <div id="pImgPreview" class="pimg"></div>
        <label>內文
          <textarea id="pBody" rows="16" maxlength="30000" required placeholder="直接打字或貼上。&#10;空一行＝換段落。&#10;一行開頭打「## 」＝小標題。&#10;&#10;建議在文末註明資料來源，例如：資料來源：聯合報、中央社"></textarea>
        </label>
        <p class="muted pcount"><span id="pCount">0</span> 字</p>
        <div class="pbtns">
          <button type="submit" class="btn-pri" data-pub="1">🚀 發布</button>
          <button type="submit" class="btn-sec" data-pub="0">💾 存成草稿</button>
          <button type="button" class="btn-sec" id="pReset">清空／取消編輯</button>
        </div>
        <p id="pMsg" class="pmsg"></p>
      </form>
    </div>
    <div class="card">
      <h2>📚 已發表的文章</h2>
      <div id="postList"><p class="muted">讀取中…</p></div>
    </div>`;

  const $ = s => root.querySelector(s);
  const msg = (t, ok) => { $("#pMsg").textContent = t; $("#pMsg").className = "pmsg " + (ok ? "ok" : "err"); };
  $("#pBody").addEventListener("input", () => $("#pCount").textContent = $("#pBody").value.length);

  $("#pImg").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      imgData = await shrinkImage(f);
      $("#pImgPreview").innerHTML = `<img src="${imgData}" alt=""><button type="button" id="pImgDel">移除照片</button>`;
      $("#pImgDel").onclick = () => { imgData = ""; $("#pImgPreview").innerHTML = ""; $("#pImg").value = ""; };
    } catch (err) { msg(err.message, false); }
  });

  function resetForm() {
    editing = null; imgData = "";
    $("#postForm").reset();
    $("#pAuthor").value = "比特王新聞網";
    $("#pImgPreview").innerHTML = "";
    $("#pCount").textContent = "0";
    $("#pfTitle").textContent = "✍ 發布新文章";
  }
  $("#pReset").onclick = () => { resetForm(); msg("", true); };

  let submitPub = true;
  root.querySelectorAll("[data-pub]").forEach(b => b.addEventListener("click", () => submitPub = b.dataset.pub === "1"));

  $("#postForm").addEventListener("submit", async e => {
    e.preventDefault();
    const data = {
      title: $("#pTitle").value.trim(),
      summary: $("#pSummary").value.trim(),
      body: $("#pBody").value.replace(/\r\n/g, "\n").trim(),
      cat: $("#pCat").value,
      img: imgData,
      author: $("#pAuthor").value.trim() || "比特王新聞網",
      published: submitPub,
      updatedAt: serverTimestamp(),
    };
    if (!data.title || !data.body) return msg("標題和內文都要填喔", false);
    msg("儲存中…", true);
    try {
      if (editing) {
        await setDoc(doc(db, "posts", editing.id), { ...data, createdAt: editing.createdAt });
      } else {
        await addDoc(collection(db, "posts"), { ...data, createdAt: serverTimestamp() });
      }
      msg(submitPub ? "✅ 已發布！網站重新整理後就看得到。" : "✅ 已存成草稿（網站上看不到）。", true);
      resetForm();
      loadList();
    } catch (err) {
      console.warn(err);
      msg("儲存失敗：" + (err.code === "permission-denied" ? "沒有權限或照片太大" : err.message), false);
    }
  });

  async function loadList() {
    const snap = await getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc")));
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const catName = v => (CATS.find(c => c[0] === v) || [, v])[1];
    $("#postList").innerHTML = list.length ? list.map(p => `
      <div class="pitem">
        ${p.img ? `<img src="${p.img}" alt="">` : `<div class="pnoimg">✍</div>`}
        <div class="pinfo">
          <b>${esc(p.title)}</b>
          <small>${catName(p.cat)}・${esc(p.author)}・${p.createdAt ? p.createdAt.toDate().toLocaleString("zh-TW") : "剛剛"}
            ・${p.published ? `<span class="tag-pub">已發布</span>` : `<span class="tag-draft">草稿</span>`}</small>
        </div>
        <div class="pact">
          ${p.published ? `<a href="./#news/p_${p.id}" target="_blank">查看</a>` : ""}
          <button data-edit="${p.id}">編輯</button>
          <button data-toggle="${p.id}">${p.published ? "改成草稿" : "發布"}</button>
          <button data-del="${p.id}" class="danger">刪除</button>
        </div>
      </div>`).join("") : `<p class="muted">還沒有文章，從上面開始寫第一篇吧！</p>`;

    root.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
      const p = list.find(x => x.id === b.dataset.edit);
      editing = p; imgData = p.img || "";
      $("#pTitle").value = p.title; $("#pCat").value = p.cat; $("#pAuthor").value = p.author;
      $("#pSummary").value = p.summary || ""; $("#pBody").value = p.body;
      $("#pCount").textContent = p.body.length;
      $("#pImgPreview").innerHTML = imgData ? `<img src="${imgData}" alt="">` : "";
      $("#pfTitle").textContent = "✏️ 編輯文章：" + p.title;
      root.scrollIntoView({ behavior: "smooth" });
    });
    root.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => {
      const p = list.find(x => x.id === b.dataset.toggle);
      const { id, ...rest } = p;
      await setDoc(doc(db, "posts", id), { ...rest, published: !p.published, updatedAt: serverTimestamp() });
      loadList();
    });
    root.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm("確定刪除這篇文章？刪除後無法復原。")) return;
      await deleteDoc(doc(db, "posts", b.dataset.del));
      loadList();
    });
  }
  loadList().catch(err => { $("#postList").innerHTML = `<p class="muted">讀取失敗：${esc(err.message)}</p>`; });
}
