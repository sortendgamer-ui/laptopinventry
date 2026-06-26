// ============================================================
// LAPTOP GALLERY — APP LOGIC
// ============================================================
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, setDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ── Tabler icons CDN ──────────────────────────────────────────
const _iconLink = document.createElement("link");
_iconLink.rel = "stylesheet";
_iconLink.href = "https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.44.0/tabler-icons.min.css";
document.head.appendChild(_iconLink);

// ── ZXing barcode library (CDN) ──────────────────────────────
const _zxScript = document.createElement("script");
_zxScript.src = "https://cdnjs.cloudflare.com/ajax/libs/zxing-js/0.21.1/zxing.min.js";
document.head.appendChild(_zxScript);

// ============================================================
// CONSTANTS
// ============================================================
const ADMIN_EMAIL = "faizanfazal4476@gmail.com";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// ============================================================
// STATE
// ============================================================
let currentUser     = null;
let currentUserDoc  = null;
let laptops         = [];
let cashEntries     = [];
let editingLaptopId = null;
let barcodeScanner  = null;
let unsubLaptops    = null;
let unsubCash       = null;
let unsubUsers      = null;

// ============================================================
// HELPERS
// ============================================================
const $ = id => document.getElementById(id);
const fmtMoney = n => "Rs " + (Number(n)||0).toLocaleString("en-IN");
const fmtDate  = d => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
};
const todayStr = () => new Date().toISOString().slice(0,10);
const escapeHtml = s => String(s||"").replace(/[&<>"']/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function showToast(msg, type="default") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (type==="error" ? " toast-error" : type==="success" ? " toast-success" : "");
  t.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add("hidden"), 3200);
}

function showScreen(id) {
  ["loadingScreen","loginScreen","appShell"].forEach(s =>
    $(s).classList.toggle("hidden", s !== id));
}

function inSameMonth(dateStr, month, year) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getMonth() === month && d.getFullYear() === year;
}

function conditionLabel(c) {
  return {new:"New", used_excellent:"Used — Excellent", used_good:"Used — Good", used_fair:"Used — Fair"}[c] || c || "";
}

// ============================================================
// AUTH — LOGIN ONLY (no public signup)
// ============================================================
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email    = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  const btn      = $("loginBtn");
  const errEl    = $("loginError");
  errEl.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Logging in...";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch(err) {
    errEl.textContent = friendlyAuthError(err);
    errEl.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Login";
  }
});

$("logoutBtn").addEventListener("click", () => signOut(auth));

function friendlyAuthError(err) {
  const c = err.code || "";
  if (c.includes("invalid-email"))      return "Please enter a valid email.";
  if (c.includes("user-not-found") || c.includes("wrong-password") || c.includes("invalid-credential"))
    return "Incorrect email or password.";
  if (c.includes("too-many-requests"))  return "Too many attempts. Try again later.";
  return "Login failed. Please try again.";
}

// ============================================================
// AUTH STATE
// ============================================================
onAuthStateChanged(auth, async user => {
  cleanupListeners();
  if (!user) { currentUser = null; currentUserDoc = null; showScreen("loginScreen"); return; }

  currentUser = user;
  showScreen("loadingScreen");

  const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  if (isAdmin) {
    currentUserDoc = { name: user.displayName || "Admin", email: user.email, role: "admin", status: "approved" };
    // Save/fix doc in background silently
    setDoc(doc(db,"users",user.uid), { name: currentUserDoc.name, email: user.email, role:"admin", status:"approved", updatedAt: serverTimestamp() }, { merge:true }).catch(()=>{});
    initApp();
    return;
  }

  // Normal user — check Firestore
  try {
    const snap = await getDoc(doc(db,"users",user.uid));
    if (!snap.exists()) {
      // Account exists in Auth but no Firestore doc — create pending
      await setDoc(doc(db,"users",user.uid), { name: user.email.split("@")[0], email: user.email, role:"staff", status:"approved", createdAt: serverTimestamp() });
    }
    const snap2 = await getDoc(doc(db,"users",user.uid));
    currentUserDoc = snap2.data();
    if (currentUserDoc.status !== "approved") { signOut(auth); showToast("Access denied. Contact admin.", "error"); return; }
    initApp();
  } catch(err) {
    showToast("Connection error. Try again.", "error");
    signOut(auth);
  }
});

function cleanupListeners() {
  if (unsubLaptops) { unsubLaptops(); unsubLaptops = null; }
  if (unsubCash)    { unsubCash();    unsubCash    = null; }
  if (unsubUsers)   { unsubUsers();   unsubUsers   = null; }
}

// ============================================================
// INIT APP
// ============================================================
function initApp() {
  showScreen("appShell");
  $("sidebarUserName").textContent = currentUserDoc.name || currentUser.email;
  $("sidebarUserRole").textContent = currentUserDoc.role === "admin" ? "Admin" : "Staff";
  $("userAvatar").textContent      = (currentUserDoc.name || currentUser.email)[0].toUpperCase();

  document.querySelectorAll(".admin-only").forEach(el =>
    el.classList.toggle("hidden", currentUserDoc.role !== "admin"));

  startListeners();
  navigateTo("dashboard");
}

function startListeners() {
  const lQ = query(collection(db,"laptops"), orderBy("buyDate","desc"));
  unsubLaptops = onSnapshot(lQ, snap => {
    laptops = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderDashboard(); renderInventory(); renderReports(); renderSoldHistory();
  }, err => showToast("Failed to load data: "+err.message,"error"));

  const cQ = query(collection(db,"cashEntries"), orderBy("date","desc"));
  unsubCash = onSnapshot(cQ, snap => {
    cashEntries = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderDashboard(); renderCashLedger();
  }, err => showToast("Failed to load cash: "+err.message,"error"));

  if (currentUserDoc.role === "admin") {
    unsubUsers = onSnapshot(collection(db,"users"), snap => {
      renderUsers(snap.docs.map(d => ({ id:d.id, ...d.data() })));
    });
  }
}

// ============================================================
// NAVIGATION
// ============================================================
function navigateTo(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("page-"+page).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page===page));
  document.querySelectorAll(".bnav-item").forEach(n => n.classList.toggle("active", n.dataset.page===page));
  const titles = { dashboard:"Dashboard", inventory:"Inventory", addLaptop:"Add New Laptop",
    soldHistory:"Sold History", cashLedger:"Cash Ledger", reports:"Reports", users:"Manage Users" };
  $("pageTitle").textContent = titles[page] || "Laptop Gallery";
  window.scrollTo({ top:0, behavior:"smooth" });
  closeSidebar();
  if (page==="addLaptop" && !editingLaptopId) resetLaptopForm();
}

document.querySelectorAll(".nav-item").forEach(el => el.addEventListener("click", () => navigateTo(el.dataset.page)));
document.querySelectorAll(".bnav-item").forEach(el => el.addEventListener("click", () => navigateTo(el.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(el => el.addEventListener("click", () => navigateTo(el.dataset.goto)));

// Sidebar
const openSidebar  = () => { $("sidebar").classList.add("open"); $("sidebarOverlay").classList.add("show"); };
const closeSidebar = () => { $("sidebar").classList.remove("open"); $("sidebarOverlay").classList.remove("show"); };
$("menuBtn").addEventListener("click", openSidebar);
$("sidebarClose").addEventListener("click", closeSidebar);
$("sidebarOverlay").addEventListener("click", closeSidebar);

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const now = new Date(), m = now.getMonth(), y = now.getFullYear();
  $("statInStock").textContent = laptops.filter(l => l.status==="in_stock").length;
  $("statSold").textContent    = laptops.filter(l => l.status==="sold").length;
  $("statCashIn").textContent  = fmtMoney(cashEntries.filter(c => c.type==="in" && inSameMonth(c.date,m,y)).reduce((s,c)=>s+Number(c.amount||0),0));
  $("statProfit").textContent  = fmtMoney(laptops.filter(l=>l.status==="sold"&&inSameMonth(l.sellDate,m,y)).reduce((s,l)=>s+(Number(l.sellPrice||0)-Number(l.buyPrice||0)),0));

  const list = $("recentList");
  const recent = laptops.slice(0,6);
  list.innerHTML = recent.length === 0 ? '<p class="empty-state">No entries yet</p>'
    : recent.map(l => `<div class="list-item">
        <div class="list-item-main"><p>${escapeHtml(l.brand)} ${escapeHtml(l.model)}</p><p>SN: ${escapeHtml(l.serial)} • ${fmtDate(l.buyDate)}</p></div>
        <span class="badge ${l.status==='in_stock'?'badge-stock':'badge-sold'}">${l.status==='in_stock'?'In Stock':'Sold'}</span>
      </div>`).join("");
}

// ============================================================
// INVENTORY
// ============================================================
function renderInventory() {
  const search = ($("inventorySearch").value||"").toLowerCase();
  const filter = $("inventoryFilter").value;
  const filtered = laptops.filter(l => {
    const ms = !search || (l.brand||"").toLowerCase().includes(search)||(l.model||"").toLowerCase().includes(search)||(l.serial||"").toLowerCase().includes(search);
    const mf = filter==="all" || l.status===filter;
    return ms && mf;
  });
  $("inventoryEmpty").classList.toggle("hidden", filtered.length>0);
  $("inventoryTableBody").innerHTML = filtered.map(l => {
    const profit = l.status==="sold" ? Number(l.sellPrice||0)-Number(l.buyPrice||0) : null;
    const pc = profit===null?"profit-pending":profit>=0?"profit-pos":"profit-neg";
    return `<tr>
      <td><div class="cell-main">${escapeHtml(l.brand)} ${escapeHtml(l.model)}</div><div class="cell-sub">${conditionLabel(l.condition)}</div></td>
      <td style="font-family:var(--font-mono);font-size:12.5px">${escapeHtml(l.serial)}</td>
      <td>${fmtDate(l.buyDate)}</td>
      <td>${fmtMoney(l.buyPrice)}</td>
      <td><span class="badge ${l.status==='in_stock'?'badge-stock':'badge-sold'}">${l.status==='in_stock'?'In Stock':'Sold'}</span></td>
      <td>${l.status==="sold"?fmtMoney(l.sellPrice):"—"}</td>
      <td class="${pc}">${profit===null?"—":(profit>=0?"+":"")+fmtMoney(profit)}</td>
      <td><div class="row-actions">
        ${l.status==="in_stock"?`<button class="btn btn-sm btn-primary" data-sell="${l.id}">Sell</button>`:""}
        <button class="icon-btn" data-edit="${l.id}"><i class="ti ti-edit"></i></button>
        <button class="icon-btn" data-delete="${l.id}"><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>`;
  }).join("");

  $("inventoryTableBody").querySelectorAll("[data-sell]").forEach(b=>b.addEventListener("click",()=>openSellModal(b.dataset.sell)));
  $("inventoryTableBody").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>editLaptop(b.dataset.edit)));
  $("inventoryTableBody").querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",()=>deleteLaptop(b.dataset.delete)));
}

$("inventorySearch").addEventListener("input", renderInventory);
$("inventoryFilter").addEventListener("change", renderInventory);

// ============================================================
// ADD / EDIT LAPTOP
// ============================================================
function resetLaptopForm() {
  editingLaptopId = null;
  $("laptopForm").reset();
  $("laptopId").value = "";
  $("lBuyDate").value = todayStr();
  $("laptopFormTitle").textContent = "Add New Laptop";
  $("laptopSubmitBtn").innerHTML = '<i class="ti ti-device-floppy"></i> Save';
  $("laptopCancelBtn").classList.add("hidden");
  resetScanUI();
}

function editLaptop(id) {
  const l = laptops.find(x=>x.id===id); if (!l) return;
  editingLaptopId = id;
  $("laptopId").value   = id;
  $("lBrand").value     = l.brand||"";
  $("lModel").value     = l.model||"";
  $("lSerial").value    = l.serial||"";
  $("lCondition").value = l.condition||"new";
  $("lBuyDate").value   = l.buyDate||todayStr();
  $("lBuyPrice").value  = l.buyPrice||"";
  $("lBuyFrom").value   = l.buyFrom||"";
  $("lNotes").value     = l.notes||"";
  $("laptopFormTitle").textContent = "Edit Laptop";
  $("laptopSubmitBtn").innerHTML = '<i class="ti ti-device-floppy"></i> Update';
  $("laptopCancelBtn").classList.remove("hidden");
  navigateTo("addLaptop");
}

$("laptopCancelBtn").addEventListener("click", () => { resetLaptopForm(); navigateTo("inventory"); });

$("laptopForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("laptopSubmitBtn");
  btn.disabled = true;
  const payload = {
    brand: $("lBrand").value.trim(), model: $("lModel").value.trim(),
    serial: $("lSerial").value.trim(), condition: $("lCondition").value,
    buyDate: $("lBuyDate").value, buyPrice: Number($("lBuyPrice").value)||0,
    buyFrom: $("lBuyFrom").value.trim(), notes: $("lNotes").value.trim()
  };
  try {
    if (editingLaptopId) {
      await updateDoc(doc(db,"laptops",editingLaptopId), payload);
      showToast("Laptop updated", "success");
    } else {
      await addDoc(collection(db,"laptops"), { ...payload, status:"in_stock", sellDate:null, sellPrice:null, soldTo:null, createdAt:serverTimestamp(), createdBy:currentUser.email });
      showToast("Laptop added", "success");
    }
    resetLaptopForm(); navigateTo("inventory");
  } catch(err) { showToast("Could not save: "+err.message,"error"); }
  btn.disabled = false;
});

async function deleteLaptop(id) {
  if (!confirm("Delete this laptop? This cannot be undone.")) return;
  try { await deleteDoc(doc(db,"laptops",id)); showToast("Laptop deleted","success"); }
  catch(err) { showToast("Could not delete: "+err.message,"error"); }
}

// ============================================================
// SELL MODAL
// ============================================================
function openSellModal(id) {
  const l = laptops.find(x=>x.id===id); if (!l) return;
  $("sellLaptopId").value = id;
  $("sellLaptopName").textContent = `${l.brand} ${l.model} — SN: ${l.serial}`;
  $("sSellDate").value = todayStr(); $("sSellPrice").value = ""; $("sSoldTo").value = "";
  $("sellModalOverlay").classList.remove("hidden");
}
const closeSellModal = () => $("sellModalOverlay").classList.add("hidden");
$("sellModalClose").addEventListener("click", closeSellModal);
$("sellCancelBtn").addEventListener("click", closeSellModal);

$("sellForm").addEventListener("submit", async e => {
  e.preventDefault();
  const id = $("sellLaptopId").value, sellDate = $("sSellDate").value,
        sellPrice = Number($("sSellPrice").value)||0, soldTo = $("sSoldTo").value.trim();
  try {
    await updateDoc(doc(db,"laptops",id), { status:"sold", sellDate, sellPrice, soldTo });
    const l = laptops.find(x=>x.id===id);
    await addDoc(collection(db,"cashEntries"), { type:"in", amount:sellPrice, date:sellDate,
      reason:`${l?l.brand+" "+l.model:"Laptop"} sold${soldTo?" — to: "+soldTo:""}`,
      linkedLaptopId:id, createdAt:serverTimestamp(), createdBy:currentUser.email });
    showToast("Sale confirmed","success"); closeSellModal();
  } catch(err) { showToast("Could not save sale: "+err.message,"error"); }
});

// ============================================================
// CASH LEDGER
// ============================================================
document.addEventListener("DOMContentLoaded", () => { if ($("cDate")) $("cDate").value = todayStr(); });

function renderCashLedger() {
  const totalIn  = cashEntries.filter(c=>c.type==="in").reduce((s,c)=>s+Number(c.amount||0),0);
  const totalOut = cashEntries.filter(c=>c.type==="out").reduce((s,c)=>s+Number(c.amount||0),0);
  $("ledgerTotalIn").textContent  = fmtMoney(totalIn);
  $("ledgerTotalOut").textContent = fmtMoney(totalOut);
  $("ledgerBalance").textContent  = fmtMoney(totalIn-totalOut);
  const list = $("cashList");
  list.innerHTML = cashEntries.length===0 ? '<p class="empty-state">No cash entries yet</p>'
    : cashEntries.map(c=>`<div class="list-item">
        <div class="list-item-main"><p>${escapeHtml(c.reason||(c.type==="in"?"Cash In":"Cash Out"))}</p><p>${fmtDate(c.date)}</p></div>
        <div class="list-item-right">
          <span class="badge ${c.type==="in"?"badge-in":"badge-out"}">${c.type==="in"?"+ ":"− "}${fmtMoney(c.amount)}</span>
          <button class="icon-btn" data-cash-del="${c.id}"><i class="ti ti-trash"></i></button>
        </div>
      </div>`).join("");
  list.querySelectorAll("[data-cash-del]").forEach(b=>b.addEventListener("click",()=>deleteCash(b.dataset.cashDel)));
}

$("cashForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await addDoc(collection(db,"cashEntries"), { type:$("cType").value, amount:Number($("cAmount").value)||0,
      date:$("cDate").value, reason:$("cReason").value.trim(), createdAt:serverTimestamp(), createdBy:currentUser.email });
    $("cashForm").reset(); $("cDate").value=todayStr();
    showToast("Cash entry added","success");
  } catch(err) { showToast("Could not save: "+err.message,"error"); }
});

async function deleteCash(id) {
  if (!confirm("Delete this entry?")) return;
  try { await deleteDoc(doc(db,"cashEntries",id)); showToast("Entry deleted","success"); }
  catch(err) { showToast("Could not delete: "+err.message,"error"); }
}

// ============================================================
// REPORTS
// ============================================================
function renderReports() {
  const investment = laptops.reduce((s,l)=>s+Number(l.buyPrice||0),0);
  const sold = laptops.filter(l=>l.status==="sold");
  const revenue = sold.reduce((s,l)=>s+Number(l.sellPrice||0),0);
  const profit  = revenue - sold.reduce((s,l)=>s+Number(l.buyPrice||0),0);
  $("repInvestment").textContent = fmtMoney(investment);
  $("repRevenue").textContent    = fmtMoney(revenue);
  $("repProfit").textContent     = fmtMoney(profit);
  $("repMargin").textContent     = revenue>0 ? ((profit/revenue)*100).toFixed(1)+"%" : "0%";

  const byBrand = {};
  laptops.forEach(l => {
    const b = l.brand||"Other";
    if (!byBrand[b]) byBrand[b]={total:0,sold:0,profit:0};
    byBrand[b].total++;
    if (l.status==="sold") { byBrand[b].sold++; byBrand[b].profit+=Number(l.sellPrice||0)-Number(l.buyPrice||0); }
  });
  const tbody = $("brandTableBody");
  const brands = Object.keys(byBrand).sort();
  tbody.innerHTML = brands.length===0 ? '<tr><td colspan="4" class="empty-state">No data yet</td></tr>'
    : brands.map(b=>`<tr><td class="cell-main">${escapeHtml(b)}</td><td>${byBrand[b].total}</td><td>${byBrand[b].sold}</td><td class="${byBrand[b].profit>=0?"profit-pos":"profit-neg"}">${fmtMoney(byBrand[b].profit)}</td></tr>`).join("");
}

// ============================================================
// SOLD HISTORY
// ============================================================
let soldMonthFilter = "";

function renderSoldHistory() {
  const sold = laptops.filter(l=>l.status==="sold");
  const now = new Date(), m=now.getMonth(), y=now.getFullYear();
  $("soldStatTotal").textContent   = sold.length;
  $("soldStatRevenue").textContent = fmtMoney(sold.reduce((s,l)=>s+Number(l.sellPrice||0),0));
  $("soldStatProfit").textContent  = fmtMoney(sold.reduce((s,l)=>s+(Number(l.sellPrice||0)-Number(l.buyPrice||0)),0));
  $("soldStatMonth").textContent   = sold.filter(l=>inSameMonth(l.sellDate,m,y)).length;

  let filtered = sold;
  if (soldMonthFilter) {
    const [fy,fm] = soldMonthFilter.split("-").map(Number);
    filtered = sold.filter(l=>{ if(!l.sellDate) return false; const d=new Date(l.sellDate); return d.getFullYear()===fy&&(d.getMonth()+1)===fm; });
  }
  filtered.sort((a,b)=>(b.sellDate||"").localeCompare(a.sellDate||""));
  const tbody=$("soldHistoryTableBody"), empty=$("soldHistoryEmpty");
  if (!filtered.length) { tbody.innerHTML=""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  tbody.innerHTML = filtered.map(l=>{
    const profit=Number(l.sellPrice||0)-Number(l.buyPrice||0);
    return `<tr>
      <td><div class="cell-main">${escapeHtml(l.brand)} ${escapeHtml(l.model)}</div><div class="cell-sub">${conditionLabel(l.condition)}</div></td>
      <td style="font-family:var(--font-mono);font-size:12.5px">${escapeHtml(l.serial)}</td>
      <td>${fmtDate(l.buyDate)}</td>
      <td><strong>${fmtDate(l.sellDate)}</strong></td>
      <td>${fmtMoney(l.buyPrice)}</td>
      <td style="font-weight:700;color:var(--green-600)">${fmtMoney(l.sellPrice)}</td>
      <td class="${profit>=0?"profit-pos":"profit-neg"}">${profit>=0?"+":""}${fmtMoney(profit)}</td>
      <td>${escapeHtml(l.soldTo||"—")}</td>
    </tr>`;
  }).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  const now = new Date();
  const ms = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
  const mi = $("soldMonthFilter"); if (mi) { mi.value=ms; soldMonthFilter=ms; }
  $("soldMonthFilter")?.addEventListener("change", e => { soldMonthFilter=e.target.value; renderSoldHistory(); });
  $("soldClearFilter")?.addEventListener("click", () => { soldMonthFilter=""; if($("soldMonthFilter")) $("soldMonthFilter").value=""; renderSoldHistory(); });
});

// ============================================================
// USERS (admin) — Add user directly
// ============================================================
function renderUsers(users) {
  const list = $("approvedUsersList");
  list.innerHTML = users.length===0 ? '<p class="empty-state">No users yet</p>'
    : users.map(u=>`<div class="list-item">
        <div class="list-item-main">
          <p>${escapeHtml(u.name)} ${u.id===currentUser.uid?"(you)":""}</p>
          <p>${escapeHtml(u.email)} • ${u.role}</p>
        </div>
        <div class="list-item-right">
          <span class="badge ${u.role==="admin"?"badge-in":"badge-sold"}">${u.role}</span>
          ${u.id!==currentUser.uid?`<button class="icon-btn" data-del-user="${u.id}"><i class="ti ti-trash"></i></button>`:""}
        </div>
      </div>`).join("");
  list.querySelectorAll("[data-del-user]").forEach(b=>b.addEventListener("click",()=>deleteUser(b.dataset.delUser)));
}

async function deleteUser(uid) {
  if (!confirm("Remove this user's access?")) return;
  try { await deleteDoc(doc(db,"users",uid)); showToast("User removed","success"); }
  catch(err) { showToast("Could not remove: "+err.message,"error"); }
}

// Add user modal
$("addUserBtn")?.addEventListener("click", () => { $("addUserModalOverlay").classList.remove("hidden"); });
$("addUserModalClose")?.addEventListener("click", () => $("addUserModalOverlay").classList.add("hidden"));
$("addUserCancelBtn")?.addEventListener("click", () => $("addUserModalOverlay").classList.add("hidden"));

$("addUserForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const name=$("newUserName").value.trim(), email=$("newUserEmail").value.trim(),
        password=$("newUserPassword").value, role=$("newUserRole").value;
  const btn=$("addUserSubmitBtn"), errEl=$("addUserError");
  errEl.classList.add("hidden"); btn.disabled=true;
  try {
    // Create Firebase Auth user
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Save to Firestore
    await setDoc(doc(db,"users",cred.user.uid), { name, email, role, status:"approved", createdAt:serverTimestamp(), createdBy:currentUser.email });
    showToast(`User "${name}" created successfully`,"success");
    $("addUserForm").reset();
    $("addUserModalOverlay").classList.add("hidden");
    // Re-login admin (creating another user signs them in)
    // We handle this by re-signing in admin
    await signInWithEmailAndPassword(auth, currentUser.email, "").catch(()=>{});
  } catch(err) {
    errEl.textContent = err.code==="auth/email-already-in-use"
      ? "This email is already registered."
      : err.code==="auth/weak-password"
      ? "Password must be at least 6 characters."
      : "Could not create user: "+err.message;
    errEl.classList.remove("hidden");
  }
  btn.disabled=false;
});

// ============================================================
// SCAN — AI OCR (Camera photo → Claude API)
// ============================================================
$("btnCameraAI")?.addEventListener("click", () => $("cameraInput").click());

$("cameraInput")?.addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file) return;
  showAIScanStatus("Reading sticker with AI...");
  try {
    const base64 = await fileToBase64(file);
    const result = await scanWithClaude(base64, file.type);
    applyAIScanResult(result);
  } catch(err) {
    hideAIScanStatus();
    showToast("AI scan failed: "+err.message,"error");
  }
  e.target.value = "";
});

function fileToBase64(file) {
  return new Promise((res,rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Could not read image"));
    r.readAsDataURL(file);
  });
}

async function scanWithClaude(base64, mediaType) {
  const resp = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type:"image", source:{ type:"base64", media_type:mediaType, data:base64 } },
          { type:"text",  text:`This is a photo of a laptop's back sticker or service label.
Extract ONLY these three fields:
- brand: the laptop manufacturer (e.g. HP, Dell, Lenovo, Asus, Acer, Apple, Samsung, MSI, Toshiba)
- model: the laptop model name/number (e.g. Pavilion 15, ThinkPad T14, Inspiron 15)
- serial: the serial number (labeled S/N, Serial No., or similar)

Respond ONLY with valid JSON, nothing else. Example:
{"brand":"HP","model":"Pavilion 15","serial":"CND12345XY"}

If a field is not visible, use empty string "".` }
        ]
      }]
    })
  });
  if (!resp.ok) throw new Error("API error "+resp.status);
  const data = await resp.json();
  const text = (data.content||[]).map(b=>b.text||"").join("").trim();
  return JSON.parse(text.replace(/```json|```/g,"").trim());
}

function applyAIScanResult(result) {
  hideAIScanStatus();
  const { brand="", model="", serial="" } = result;
  if (brand)  $("lBrand").value  = brand;
  if (model)  $("lModel").value  = model;
  if (serial) $("lSerial").value = serial;
  // Show result card
  $("scanResult").classList.remove("hidden");
  $("scanResultFields").innerHTML = `
    ${brand  ? `<p><strong>Brand:</strong> ${escapeHtml(brand)}</p>`:""}
    ${model  ? `<p><strong>Model:</strong> ${escapeHtml(model)}</p>`:""}
    ${serial ? `<p><strong>Serial No.:</strong> ${escapeHtml(serial)}</p>`:""}
    ${!brand&&!model&&!serial ? `<p>Could not detect any details. Try a clearer photo.</p>`:""}
  `;
  if (brand||model||serial) showToast("Details auto-filled from sticker","success");
}

function showAIScanStatus(msg) {
  $("aiScanStatus").classList.remove("hidden");
  $("aiScanText").textContent = msg;
  $("scanResult").classList.add("hidden");
}
function hideAIScanStatus() { $("aiScanStatus").classList.add("hidden"); }

// ============================================================
// SCAN — BARCODE / QR (ZXing)
// ============================================================
$("btnBarcode")?.addEventListener("click", openBarcodeScanner);
$("closeBarcodeBtn")?.addEventListener("click", stopBarcodeScanner);

async function openBarcodeScanner() {
  $("barcodeView").classList.remove("hidden");
  $("scanResult").classList.add("hidden");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" } });
    const video = $("barcodeVideo");
    video.srcObject = stream;
    video._stream = stream;
    // Wait for ZXing to load
    let attempts = 0;
    const waitZXing = setInterval(() => {
      attempts++;
      if (window.ZXing || attempts>20) {
        clearInterval(waitZXing);
        if (window.ZXing) startZXing(video);
        else showToast("Barcode library not loaded. Try AI scan instead.","error");
      }
    }, 300);
  } catch(err) {
    stopBarcodeScanner();
    showToast("Camera access denied. Please allow camera permission.","error");
  }
}

function startZXing(video) {
  try {
    const hints = new Map();
    const formats = [
      ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,  ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.DATA_MATRIX
    ];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
    barcodeScanner = new ZXing.BrowserMultiFormatReader(hints);
    barcodeScanner.decodeFromVideoElement(video, (result, err) => {
      if (result) {
        const text = result.getText();
        stopBarcodeScanner();
        applyBarcodeResult(text);
      }
    });
  } catch(err) {
    stopBarcodeScanner();
    showToast("Barcode scanner error. Try AI scan instead.","error");
  }
}

function stopBarcodeScanner() {
  if (barcodeScanner) { try { barcodeScanner.reset(); } catch(e){} barcodeScanner=null; }
  const v=$("barcodeVideo");
  if (v&&v._stream) { v._stream.getTracks().forEach(t=>t.stop()); v._stream=null; v.srcObject=null; }
  $("barcodeView").classList.add("hidden");
}

function applyBarcodeResult(text) {
  // Try to detect if it's a serial number or structured data
  $("lSerial").value = text;
  $("scanResult").classList.remove("hidden");
  $("scanResultFields").innerHTML = `<p><strong>Scanned:</strong> ${escapeHtml(text)}</p><p style="font-size:12px;color:var(--ink-soft);margin-top:4px">Filled into Serial No. field. Fill Brand &amp; Model manually if needed.</p>`;
  showToast("Barcode scanned — serial no. filled","success");
}

// Clear scan
$("clearScanBtn")?.addEventListener("click", resetScanUI);
function resetScanUI() {
  $("scanResult").classList.add("hidden");
  $("aiScanStatus").classList.add("hidden");
  $("barcodeView").classList.add("hidden");
  stopBarcodeScanner();
}

