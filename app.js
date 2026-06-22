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

// ---------- Tabler icon loader (CDN, webfont) ----------
(function loadIcons() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.44.0/tabler-icons.min.css";
  document.head.appendChild(link);
})();

function renderIcons() {
  document.querySelectorAll("i[data-icon]").forEach(el => {
    const name = el.getAttribute("data-icon");
    el.className = "ti ti-" + name;
    el.removeAttribute("data-icon");
  });
}

// ============================================================
// STATE
// ============================================================
let currentUser = null;
let currentUserDoc = null; // { name, email, role: 'admin'|'staff', status: 'pending'|'approved' }
let laptops = [];
let cashEntries = [];
let unsubLaptops = null;
let unsubCash = null;
let unsubUsers = null;
let editingLaptopId = null;

const ADMIN_EMAILS = ["faizanfazal4476@gmail.com"]; // ye email hamesha admin + approved banega

// ============================================================
// HELPERS
// ============================================================
function $(id) { return document.getElementById(id); }
function fmtMoney(n) {
  n = Number(n) || 0;
  return "Rs " + n.toLocaleString("en-IN");
}
function fmtDate(d) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function showToast(msg, type = "default") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (type === "error" ? " toast-error" : type === "success" ? " toast-success" : "");
  t.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add("hidden"), 3000);
}
function showScreen(id) {
  ["loadingScreen", "loginScreen", "signupScreen", "pendingScreen", "appShell"].forEach(s => {
    $(s).classList.toggle("hidden", s !== id);
  });
}

// ============================================================
// AUTH
// ============================================================
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  const btn = $("loginBtn");
  $("loginError").classList.add("hidden");
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    $("loginError").textContent = friendlyAuthError(err);
    $("loginError").classList.remove("hidden");
  }
  btn.disabled = false;
});

$("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("signupName").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value;
  const btn = $("signupBtn");
  $("signupError").classList.add("hidden");
  btn.disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Pehla user (ya whitelisted email) seedha admin + approved hota hai
    const isFirstUser = await checkIsFirstUser();
    const isWhitelisted = ADMIN_EMAILS.includes(email.toLowerCase());
    const role = (isFirstUser || isWhitelisted) ? "admin" : "staff";
    const status = (isFirstUser || isWhitelisted) ? "approved" : "pending";
    await setDoc(doc(db, "users", cred.user.uid), {
      name, email, role, status, createdAt: serverTimestamp()
    });
  } catch (err) {
    $("signupError").textContent = friendlyAuthError(err);
    $("signupError").classList.remove("hidden");
  }
  btn.disabled = false;
});

async function checkIsFirstUser() {
  // Simple heuristic: try reading a marker doc; if absent, this is the first user.
  const markerRef = doc(db, "meta", "firstUserClaimed");
  const snap = await getDoc(markerRef);
  if (snap.exists()) return false;
  await setDoc(markerRef, { claimedAt: serverTimestamp() });
  return true;
}

function friendlyAuthError(err) {
  const code = err.code || "";
  if (code.includes("email-already-in-use")) return "Ye email pehle se registered hai.";
  if (code.includes("invalid-email")) return "Email sahi format me nahi hai.";
  if (code.includes("weak-password")) return "Password kam se kam 6 characters ka hona chahiye.";
  if (code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential")) return "Email ya password galat hai.";
  if (code.includes("too-many-requests")) return "Bahut zyada attempts ho gaye. Thodi der baad try karein.";
  return "Kuch galat ho gaya. Dobara try karein.";
}

$("showSignupBtn").addEventListener("click", () => showScreen("signupScreen"));
$("showLoginBtn").addEventListener("click", () => showScreen("loginScreen"));
$("logoutBtn").addEventListener("click", () => signOut(auth));
$("pendingLogoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  cleanupListeners();
  if (!user) {
    currentUser = null;
    currentUserDoc = null;
    showScreen("loginScreen");
    return;
  }
  currentUser = user;
  showScreen("loadingScreen");
  const isWhitelistedAdmin = ADMIN_EMAILS.includes((user.email || "").toLowerCase());
  const userSnap = await getDoc(doc(db, "users", user.uid));

  if (!userSnap.exists()) {
    // Edge case: auth account exists par users/ doc nahi (shayad purana account) — bana dein
    await setDoc(doc(db, "users", user.uid), {
      name: user.email.split("@")[0], email: user.email,
      role: isWhitelistedAdmin ? "admin" : "staff",
      status: isWhitelistedAdmin ? "approved" : "pending",
      createdAt: serverTimestamp()
    });
  } else if (isWhitelistedAdmin) {
    // Whitelisted email hamesha admin + approved force ho (chahe pehle pending/staff ho)
    const existing = userSnap.data();
    if (existing.role !== "admin" || existing.status !== "approved") {
      await updateDoc(doc(db, "users", user.uid), { role: "admin", status: "approved" });
    }
  }

  const snap = await getDoc(doc(db, "users", user.uid));
  currentUserDoc = snap.data();

  if (currentUserDoc.status !== "approved") {
    showScreen("pendingScreen");
    return;
  }

  initAppShell();
});

// ============================================================
// APP SHELL INIT
// ============================================================
function initAppShell() {
  showScreen("appShell");
  $("sidebarUserName").textContent = currentUserDoc.name || currentUser.email;
  $("sidebarUserRole").textContent = currentUserDoc.role === "admin" ? "Admin" : "Staff";
  $("userAvatar").textContent = (currentUserDoc.name || currentUser.email)[0].toUpperCase();

  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("hidden", currentUserDoc.role !== "admin");
  });

  attachListeners();
  navigateTo("dashboard");
  renderIcons();
}

function cleanupListeners() {
  if (unsubLaptops) { unsubLaptops(); unsubLaptops = null; }
  if (unsubCash) { unsubCash(); unsubCash = null; }
  if (unsubUsers) { unsubUsers(); unsubUsers = null; }
}

function attachListeners() {
  const laptopsQ = query(collection(db, "laptops"), orderBy("buyDate", "desc"));
  unsubLaptops = onSnapshot(laptopsQ, (snap) => {
    laptops = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDashboard();
    renderInventory();
    renderReports();
  }, (err) => showToast("Data load nahi ho saka: " + err.message, "error"));

  const cashQ = query(collection(db, "cashEntries"), orderBy("date", "desc"));
  unsubCash = onSnapshot(cashQ, (snap) => {
    cashEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDashboard();
    renderCashLedger();
  }, (err) => showToast("Cash data load nahi ho saka: " + err.message, "error"));

  if (currentUserDoc.role === "admin") {
    const usersQ = collection(db, "users");
    unsubUsers = onSnapshot(usersQ, (snap) => {
      const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderUsers(users);
    });
  }
}

// ============================================================
// NAVIGATION
// ============================================================
function navigateTo(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("page-" + page).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === page));
  const titles = {
    dashboard: "Dashboard", inventory: "Inventory", addLaptop: "Naya laptop add karein",
    cashLedger: "Cash ledger", reports: "Reports", users: "Users manage karein"
  };
  $("pageTitle").textContent = titles[page] || "Laptop Gallery";
  closeSidebar();
  if (page === "addLaptop" && !editingLaptopId) resetLaptopForm();
}

document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => navigateTo(item.dataset.page));
});
document.querySelectorAll("[data-goto]").forEach(el => {
  el.addEventListener("click", () => navigateTo(el.dataset.goto));
});

// Mobile sidebar
function openSidebar() { $("sidebar").classList.add("open"); $("sidebarOverlay").classList.add("show"); }
function closeSidebar() { $("sidebar").classList.remove("open"); $("sidebarOverlay").classList.remove("show"); }
$("menuBtn").addEventListener("click", openSidebar);
$("sidebarClose").addEventListener("click", closeSidebar);
$("sidebarOverlay").addEventListener("click", closeSidebar);

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const inStock = laptops.filter(l => l.status === "in_stock").length;
  const sold = laptops.filter(l => l.status === "sold").length;

  const now = new Date();
  const thisMonth = now.getMonth(), thisYear = now.getFullYear();

  const cashInMonth = cashEntries
    .filter(c => c.type === "in" && inSameMonth(c.date, thisMonth, thisYear))
    .reduce((s, c) => s + Number(c.amount || 0), 0);

  const profitMonth = laptops
    .filter(l => l.status === "sold" && l.sellDate && inSameMonth(l.sellDate, thisMonth, thisYear))
    .reduce((s, l) => s + (Number(l.sellPrice || 0) - Number(l.buyPrice || 0)), 0);

  $("statInStock").textContent = inStock;
  $("statSold").textContent = sold;
  $("statCashIn").textContent = fmtMoney(cashInMonth);
  $("statProfit").textContent = fmtMoney(profitMonth);

  const recent = [...laptops].slice(0, 6);
  const list = $("recentList");
  if (recent.length === 0) {
    list.innerHTML = '<p class="empty-state">Koi entry nahi hai abhi</p>';
    return;
  }
  list.innerHTML = recent.map(l => `
    <div class="list-item">
      <div class="list-item-main">
        <p>${escapeHtml(l.brand)} ${escapeHtml(l.model)}</p>
        <p>SN: ${escapeHtml(l.serial)} • ${fmtDate(l.buyDate)}</p>
      </div>
      <div class="list-item-right">
        <span class="badge ${l.status === 'in_stock' ? 'badge-stock' : 'badge-sold'}">${l.status === 'in_stock' ? 'Stock me' : 'Sold'}</span>
      </div>
    </div>
  `).join("");
}

function inSameMonth(dateStr, month, year) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getMonth() === month && d.getFullYear() === year;
}

function escapeHtml(s) {
  if (s === undefined || s === null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ============================================================
// INVENTORY
// ============================================================
function renderInventory() {
  const searchVal = ($("inventorySearch").value || "").toLowerCase();
  const filterVal = $("inventoryFilter").value;

  let filtered = laptops.filter(l => {
    const matchesSearch = !searchVal ||
      (l.brand || "").toLowerCase().includes(searchVal) ||
      (l.model || "").toLowerCase().includes(searchVal) ||
      (l.serial || "").toLowerCase().includes(searchVal);
    const matchesFilter = filterVal === "all" || l.status === filterVal;
    return matchesSearch && matchesFilter;
  });

  const tbody = $("inventoryTableBody");
  $("inventoryEmpty").classList.toggle("hidden", filtered.length > 0);

  tbody.innerHTML = filtered.map(l => {
    const profit = l.status === "sold" ? (Number(l.sellPrice || 0) - Number(l.buyPrice || 0)) : null;
    const profitClass = profit === null ? "profit-pending" : profit >= 0 ? "profit-pos" : "profit-neg";
    const profitText = profit === null ? "—" : fmtMoney(profit);
    return `
      <tr>
        <td>
          <div class="cell-main">${escapeHtml(l.brand)} ${escapeHtml(l.model)}</div>
          <div class="cell-sub">${conditionLabel(l.condition)}</div>
        </td>
        <td>${escapeHtml(l.serial)}</td>
        <td>${fmtDate(l.buyDate)}</td>
        <td>${fmtMoney(l.buyPrice)}</td>
        <td><span class="badge ${l.status === 'in_stock' ? 'badge-stock' : 'badge-sold'}">${l.status === 'in_stock' ? 'Stock me' : 'Sold'}</span></td>
        <td>${l.status === 'sold' ? fmtMoney(l.sellPrice) : '—'}</td>
        <td class="${profitClass}">${profitText}</td>
        <td>
          <div class="row-actions">
            ${l.status === 'in_stock' ? `<button class="btn btn-sm btn-primary" data-sell="${l.id}">Bechein</button>` : ""}
            <button class="icon-btn" data-edit="${l.id}" aria-label="Edit"><i class="ti ti-edit"></i></button>
            <button class="icon-btn" data-delete="${l.id}" aria-label="Delete"><i class="ti ti-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-sell]").forEach(b => b.addEventListener("click", () => openSellModal(b.dataset.sell)));
  tbody.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => editLaptop(b.dataset.edit)));
  tbody.querySelectorAll("[data-delete]").forEach(b => b.addEventListener("click", () => deleteLaptop(b.dataset.delete)));
}

function conditionLabel(c) {
  return { new: "Naya", used_excellent: "Used — excellent", used_good: "Used — good", used_fair: "Used — fair" }[c] || c || "";
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
  $("laptopFormTitle").textContent = "Naya laptop add karein";
  $("laptopSubmitBtn").innerHTML = '<i class="ti ti-device-floppy"></i> Save karein';
  $("laptopCancelBtn").classList.add("hidden");
}
$("lBuyDate").value = todayStr();

function editLaptop(id) {
  const l = laptops.find(x => x.id === id);
  if (!l) return;
  editingLaptopId = id;
  $("laptopId").value = id;
  $("lBrand").value = l.brand || "";
  $("lModel").value = l.model || "";
  $("lSerial").value = l.serial || "";
  $("lCondition").value = l.condition || "new";
  $("lBuyDate").value = l.buyDate || todayStr();
  $("lBuyPrice").value = l.buyPrice || "";
  $("lBuyFrom").value = l.buyFrom || "";
  $("lNotes").value = l.notes || "";
  $("laptopFormTitle").textContent = "Laptop edit karein";
  $("laptopSubmitBtn").innerHTML = '<i class="ti ti-device-floppy"></i> Update karein';
  $("laptopCancelBtn").classList.remove("hidden");
  navigateTo("addLaptop");
  renderIcons();
}

$("laptopCancelBtn").addEventListener("click", () => { resetLaptopForm(); navigateTo("inventory"); });

$("laptopForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("laptopSubmitBtn");
  btn.disabled = true;
  const payload = {
    brand: $("lBrand").value.trim(),
    model: $("lModel").value.trim(),
    serial: $("lSerial").value.trim(),
    condition: $("lCondition").value,
    buyDate: $("lBuyDate").value,
    buyPrice: Number($("lBuyPrice").value) || 0,
    buyFrom: $("lBuyFrom").value.trim(),
    notes: $("lNotes").value.trim(),
  };
  try {
    if (editingLaptopId) {
      await updateDoc(doc(db, "laptops", editingLaptopId), payload);
      showToast("Laptop update ho gaya", "success");
    } else {
      payload.status = "in_stock";
      payload.sellDate = null;
      payload.sellPrice = null;
      payload.soldTo = null;
      payload.createdAt = serverTimestamp();
      payload.createdBy = currentUser.email;
      await addDoc(collection(db, "laptops"), payload);
      showToast("Laptop add ho gaya", "success");
    }
    resetLaptopForm();
    navigateTo("inventory");
  } catch (err) {
    showToast("Save nahi ho saka: " + err.message, "error");
  }
  btn.disabled = false;
});

async function deleteLaptop(id) {
  if (!confirm("Pakka delete karna hai? Ye wapas nahi aayega.")) return;
  try {
    await deleteDoc(doc(db, "laptops", id));
    showToast("Laptop delete ho gaya", "success");
  } catch (err) {
    showToast("Delete nahi ho saka: " + err.message, "error");
  }
}

// ============================================================
// SELL LAPTOP (modal)
// ============================================================
function openSellModal(id) {
  const l = laptops.find(x => x.id === id);
  if (!l) return;
  $("sellLaptopId").value = id;
  $("sellLaptopName").textContent = `${l.brand} ${l.model} — SN: ${l.serial}`;
  $("sSellDate").value = todayStr();
  $("sSellPrice").value = "";
  $("sSoldTo").value = "";
  $("sellModalOverlay").classList.remove("hidden");
}
function closeSellModal() { $("sellModalOverlay").classList.add("hidden"); }
$("sellModalClose").addEventListener("click", closeSellModal);
$("sellCancelBtn").addEventListener("click", closeSellModal);

$("sellForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("sellLaptopId").value;
  const sellDate = $("sSellDate").value;
  const sellPrice = Number($("sSellPrice").value) || 0;
  const soldTo = $("sSoldTo").value.trim();
  try {
    await updateDoc(doc(db, "laptops", id), {
      status: "sold", sellDate, sellPrice, soldTo
    });
    // Auto cash-in entry banate hain sale ke liye
    const l = laptops.find(x => x.id === id);
    await addDoc(collection(db, "cashEntries"), {
      type: "in", amount: sellPrice, date: sellDate,
      reason: `${l ? l.brand + ' ' + l.model : 'Laptop'} sale${soldTo ? ' — ' + soldTo : ''}`,
      linkedLaptopId: id, createdAt: serverTimestamp(), createdBy: currentUser.email
    });
    showToast("Sale confirm ho gayi", "success");
    closeSellModal();
  } catch (err) {
    showToast("Sale save nahi hui: " + err.message, "error");
  }
});

// ============================================================
// CASH LEDGER
// ============================================================
$("cDate").value = todayStr();

function renderCashLedger() {
  const totalIn = cashEntries.filter(c => c.type === "in").reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalOut = cashEntries.filter(c => c.type === "out").reduce((s, c) => s + Number(c.amount || 0), 0);
  $("ledgerTotalIn").textContent = fmtMoney(totalIn);
  $("ledgerTotalOut").textContent = fmtMoney(totalOut);
  $("ledgerBalance").textContent = fmtMoney(totalIn - totalOut);

  const list = $("cashList");
  if (cashEntries.length === 0) {
    list.innerHTML = '<p class="empty-state">Koi cash entry nahi hai</p>';
    return;
  }
  list.innerHTML = cashEntries.map(c => `
    <div class="list-item">
      <div class="list-item-main">
        <p>${escapeHtml(c.reason || (c.type === 'in' ? 'Cash in' : 'Cash out'))}</p>
        <p>${fmtDate(c.date)}</p>
      </div>
      <div class="list-item-right">
        <span class="badge ${c.type === 'in' ? 'badge-in' : 'badge-out'}">${c.type === 'in' ? '+ ' : '− '}${fmtMoney(c.amount)}</span>
        <button class="icon-btn" data-cash-delete="${c.id}" aria-label="Delete"><i class="ti ti-trash"></i></button>
      </div>
    </div>
  `).join("");
  list.querySelectorAll("[data-cash-delete]").forEach(b => b.addEventListener("click", () => deleteCashEntry(b.dataset.cashDelete)));
  renderIcons();
}

$("cashForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    type: $("cType").value,
    amount: Number($("cAmount").value) || 0,
    date: $("cDate").value,
    reason: $("cReason").value.trim(),
    createdAt: serverTimestamp(),
    createdBy: currentUser.email
  };
  try {
    await addDoc(collection(db, "cashEntries"), payload);
    $("cashForm").reset();
    $("cDate").value = todayStr();
    showToast("Cash entry add ho gayi", "success");
  } catch (err) {
    showToast("Save nahi ho saka: " + err.message, "error");
  }
});

async function deleteCashEntry(id) {
  if (!confirm("Ye entry delete karni hai?")) return;
  try {
    await deleteDoc(doc(db, "cashEntries", id));
    showToast("Entry delete ho gayi", "success");
  } catch (err) {
    showToast("Delete nahi ho saka: " + err.message, "error");
  }
}

// ============================================================
// REPORTS
// ============================================================
function renderReports() {
  const investment = laptops.reduce((s, l) => s + Number(l.buyPrice || 0), 0);
  const soldLaptops = laptops.filter(l => l.status === "sold");
  const revenue = soldLaptops.reduce((s, l) => s + Number(l.sellPrice || 0), 0);
  const costOfSold = soldLaptops.reduce((s, l) => s + Number(l.buyPrice || 0), 0);
  const profit = revenue - costOfSold;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  $("repInvestment").textContent = fmtMoney(investment);
  $("repRevenue").textContent = fmtMoney(revenue);
  $("repProfit").textContent = fmtMoney(profit);
  $("repMargin").textContent = margin.toFixed(1) + "%";

  const byBrand = {};
  laptops.forEach(l => {
    const b = l.brand || "Other";
    if (!byBrand[b]) byBrand[b] = { total: 0, sold: 0, profit: 0 };
    byBrand[b].total++;
    if (l.status === "sold") {
      byBrand[b].sold++;
      byBrand[b].profit += (Number(l.sellPrice || 0) - Number(l.buyPrice || 0));
    }
  });

  const tbody = $("brandTableBody");
  const brands = Object.keys(byBrand).sort();
  if (brands.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Abhi koi data nahi hai</td></tr>';
    return;
  }
  tbody.innerHTML = brands.map(b => {
    const d = byBrand[b];
    const profitClass = d.profit >= 0 ? "profit-pos" : "profit-neg";
    return `<tr><td class="cell-main">${escapeHtml(b)}</td><td>${d.total}</td><td>${d.sold}</td><td class="${profitClass}">${fmtMoney(d.profit)}</td></tr>`;
  }).join("");
}

// ============================================================
// USERS (admin)
// ============================================================
function renderUsers(users) {
  const pending = users.filter(u => u.status === "pending");
  const approved = users.filter(u => u.status === "approved");

  const pendingList = $("pendingUsersList");
  pendingList.innerHTML = pending.length === 0
    ? '<p class="empty-state">Koi pending request nahi hai</p>'
    : pending.map(u => `
      <div class="list-item">
        <div class="list-item-main">
          <p>${escapeHtml(u.name)}</p>
          <p>${escapeHtml(u.email)}</p>
        </div>
        <div class="list-item-right">
          <button class="btn btn-sm btn-primary" data-approve="${u.id}">Approve</button>
          <button class="icon-btn" data-reject="${u.id}" aria-label="Reject"><i class="ti ti-x"></i></button>
        </div>
      </div>
    `).join("");

  const approvedList = $("approvedUsersList");
  approvedList.innerHTML = approved.length === 0
    ? '<p class="empty-state">Koi approved user nahi hai</p>'
    : approved.map(u => `
      <div class="list-item">
        <div class="list-item-main">
          <p>${escapeHtml(u.name)} ${u.id === currentUser.uid ? "(aap)" : ""}</p>
          <p>${escapeHtml(u.email)} • ${u.role}</p>
        </div>
        <div class="list-item-right">
          ${u.id !== currentUser.uid ? `<button class="icon-btn" data-remove="${u.id}" aria-label="Remove"><i class="ti ti-trash"></i></button>` : ""}
        </div>
      </div>
    `).join("");

  pendingList.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", () => setUserStatus(b.dataset.approve, "approved")));
  pendingList.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", () => setUserStatus(b.dataset.reject, "rejected")));
  approvedList.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => setUserStatus(b.dataset.remove, "pending")));
  renderIcons();
}

async function setUserStatus(uid, status) {
  try {
    await updateDoc(doc(db, "users", uid), { status });
    showToast("User update ho gaya", "success");
  } catch (err) {
    showToast("Update nahi ho saka: " + err.message, "error");
  }
}

// ============================================================
// INITIAL ICON RENDER (auth screens before app loads)
// ============================================================
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(renderIcons, 300);
});
