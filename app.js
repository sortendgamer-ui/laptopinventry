// ============================================================
// LAPTOP GALLERY — APP LOGIC (No login — open access)
// ============================================================
import { db } from "./firebase-config.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ── Tabler icons CDN ──────────────────────────────────────────
const _iconLink = document.createElement("link");
_iconLink.rel = "stylesheet";
_iconLink.href = "https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.44.0/tabler-icons.min.css";
document.head.appendChild(_iconLink);

// ── Html5-QRCode library loader (most reliable barcode scanner) ──
let _qrLibReady = null;
function loadQRLib() {
  if (_qrLibReady) return _qrLibReady;
  _qrLibReady = new Promise((resolve, reject) => {
    if (window.Html5Qrcode) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js";
    s.onload  = () => window.Html5Qrcode ? resolve() : reject(new Error("Library failed to init"));
    s.onerror = () => reject(new Error("Could not load scanner library. Check internet connection."));
    document.head.appendChild(s);
  });
  return _qrLibReady;
}

// ============================================================
// CONSTANTS
// ============================================================
// No AI — barcode scanner only
const MAX_PHOTO_DIM  = 1000; // resize photos before storing (keeps Firestore doc size small)

// ============================================================
// STATE
// ============================================================
let laptops         = [];
let cashEntries      = [];
let editingLaptopId  = null;
let unsubLaptops     = null;
let unsubCash        = null;
let currentPhotoData = null; // base64 data URL of laptop photo (for add/edit form)

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

function inSameMonth(dateStr, month, year) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getMonth() === month && d.getFullYear() === year;
}

function conditionLabel(c) {
  return {new:"New", used_excellent:"Used — Excellent", used_good:"Used — Good", used_fair:"Used — Fair"}[c] || c || "";
}

function laptopThumb(l) {
  if (l.photo) return `<img src="${l.photo}" class="laptop-thumb" alt="">`;
  return `<div class="laptop-thumb laptop-thumb-placeholder"><i class="ti ti-device-laptop"></i></div>`;
}

// ============================================================
// APP INIT (no auth — straight to dashboard)
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  $("loadingScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  if ($("cDate")) $("cDate").value = todayStr();
  if ($("lBuyDate")) $("lBuyDate").value = todayStr();

  startListeners();
  navigateTo("dashboard");

  const now = new Date();
  const ms = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
  const mi = $("soldMonthFilter"); if (mi) { mi.value = ms; soldMonthFilter = ms; }
});

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
    soldHistory:"Sold History", cashLedger:"Cash Ledger", reports:"Reports" };
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
$("menuBtn")?.addEventListener("click", openSidebar);
$("sidebarClose")?.addEventListener("click", closeSidebar);
$("sidebarOverlay")?.addEventListener("click", closeSidebar);

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
        <div class="list-item-photo">${laptopThumb(l)}</div>
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
      <td><div class="row-with-photo">${laptopThumb(l)}<div><div class="cell-main">${escapeHtml(l.brand)} ${escapeHtml(l.model)}</div><div class="cell-sub">${conditionLabel(l.condition)}</div></div></div></td>
      <td style="font-family:var(--mono);font-size:12.5px">${escapeHtml(l.serial)}</td>
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

$("inventorySearch")?.addEventListener("input", renderInventory);
$("inventoryFilter")?.addEventListener("change", renderInventory);

// ============================================================
// PHOTO UPLOAD (resize + base64, stored in Firestore doc)
// ============================================================
function resizeImageFile(file, maxDim = MAX_PHOTO_DIM) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round(height * (maxDim/width)); width = maxDim; }
        else if (height > maxDim) { width = Math.round(width * (maxDim/height)); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

$("addPhotoBtn")?.addEventListener("click", () => $("photoInput").click());
$("changePhotoBtn")?.addEventListener("click", () => $("photoInput").click());

$("photoInput")?.addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    showToast("Processing photo...");
    currentPhotoData = await resizeImageFile(file);
    renderPhotoPreview();
  } catch(err) { showToast("Could not process photo: "+err.message, "error"); }
  e.target.value = "";
});

$("removePhotoBtn")?.addEventListener("click", () => {
  currentPhotoData = null;
  renderPhotoPreview();
});

function renderPhotoPreview() {
  const wrap = $("photoPreviewWrap");
  const empty = $("photoEmptyState");
  if (currentPhotoData) {
    wrap.classList.remove("hidden");
    empty.classList.add("hidden");
    $("photoPreviewImg").src = currentPhotoData;
  } else {
    wrap.classList.add("hidden");
    empty.classList.remove("hidden");
  }
}

// ============================================================
// ADD / EDIT LAPTOP
// ============================================================
function resetLaptopForm() {
  editingLaptopId = null;
  currentPhotoData = null;
  $("laptopForm").reset();
  $("laptopId").value = "";
  $("lBuyDate").value = todayStr();
  $("laptopFormTitle").textContent = "Add New Laptop";
  $("laptopSubmitBtn").innerHTML = '<i class="ti ti-device-floppy"></i> Save';
  $("laptopCancelBtn").classList.add("hidden");
  renderPhotoPreview();
  resetScanUI();
}

function editLaptop(id) {
  const l = laptops.find(x=>x.id===id); if (!l) return;
  editingLaptopId = id;
  currentPhotoData = l.photo || null;
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
  renderPhotoPreview();
  navigateTo("addLaptop");
}

$("laptopCancelBtn")?.addEventListener("click", () => { resetLaptopForm(); navigateTo("inventory"); });

$("laptopForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("laptopSubmitBtn");
  btn.disabled = true;
  const payload = {
    brand: $("lBrand").value.trim(), model: $("lModel").value.trim(),
    serial: $("lSerial").value.trim(), condition: $("lCondition").value,
    buyDate: $("lBuyDate").value, buyPrice: Number($("lBuyPrice").value)||0,
    buyFrom: $("lBuyFrom").value.trim(), notes: $("lNotes").value.trim(),
    photo: currentPhotoData || null
  };
  try {
    if (editingLaptopId) {
      await updateDoc(doc(db,"laptops",editingLaptopId), payload);
      showToast("Laptop updated", "success");
    } else {
      await addDoc(collection(db,"laptops"), { ...payload, status:"in_stock", sellDate:null, sellPrice:null, soldTo:null, createdAt:serverTimestamp() });
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
$("sellModalClose")?.addEventListener("click", closeSellModal);
$("sellCancelBtn")?.addEventListener("click", closeSellModal);

$("sellForm").addEventListener("submit", async e => {
  e.preventDefault();
  const id = $("sellLaptopId").value, sellDate = $("sSellDate").value,
        sellPrice = Number($("sSellPrice").value)||0, soldTo = $("sSoldTo").value.trim();
  try {
    await updateDoc(doc(db,"laptops",id), { status:"sold", sellDate, sellPrice, soldTo });
    const l = laptops.find(x=>x.id===id);
    await addDoc(collection(db,"cashEntries"), { type:"in", amount:sellPrice, date:sellDate,
      reason:`${l?l.brand+" "+l.model:"Laptop"} sold${soldTo?" — to: "+soldTo:""}`,
      linkedLaptopId:id, createdAt:serverTimestamp() });
    showToast("Sale confirmed","success"); closeSellModal();
  } catch(err) { showToast("Could not save sale: "+err.message,"error"); }
});

// ============================================================
// CASH LEDGER
// ============================================================
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

$("cashForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await addDoc(collection(db,"cashEntries"), { type:$("cType").value, amount:Number($("cAmount").value)||0,
      date:$("cDate").value, reason:$("cReason").value.trim(), createdAt:serverTimestamp() });
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
      <td><div class="row-with-photo">${laptopThumb(l)}<div><div class="cell-main">${escapeHtml(l.brand)} ${escapeHtml(l.model)}</div><div class="cell-sub">${conditionLabel(l.condition)}</div></div></div></td>
      <td style="font-family:var(--mono);font-size:12.5px">${escapeHtml(l.serial)}</td>
      <td>${fmtDate(l.buyDate)}</td>
      <td><strong>${fmtDate(l.sellDate)}</strong></td>
      <td>${fmtMoney(l.buyPrice)}</td>
      <td style="font-weight:700;color:#6EE7B7">${fmtMoney(l.sellPrice)}</td>
      <td class="${profit>=0?"profit-pos":"profit-neg"}">${profit>=0?"+":""}${fmtMoney(profit)}</td>
      <td>${escapeHtml(l.soldTo||"—")}</td>
    </tr>`;
  }).join("");
}

$("soldMonthFilter")?.addEventListener("change", e => { soldMonthFilter=e.target.value; renderSoldHistory(); });
$("soldClearFilter")?.addEventListener("click", () => { soldMonthFilter=""; if($("soldMonthFilter")) $("soldMonthFilter").value=""; renderSoldHistory(); });



// ============================================================
// BARCODE / QR SCANNER — Html5-QRCode (battle-tested, reliable)
// Works exactly like a real barcode scanner app.
// Supports: QR, Code128, Code39, EAN-13, EAN-8, UPC-A,
//           UPC-E, ITF, Codabar, DataMatrix, PDF417
// ============================================================
let _qrScanner = null;

$("btnBarcode")?.addEventListener("click", openScanner);
$("closeBarcodeBtn")?.addEventListener("click", closeScanner);

async function openScanner() {
  // Check HTTPS
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    showToast("Camera needs HTTPS to work. Make sure your site URL starts with https://", "error");
    return;
  }
  // Check camera API exists
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Camera not supported in this browser. Try Chrome or Safari.", "error");
    return;
  }

  $("scanResult").classList.add("hidden");
  $("barcodeView").classList.remove("hidden");
  $("barcodeHint").textContent = "Loading scanner...";

  // Load library
  try {
    await loadQRLib();
  } catch (err) {
    showToast(err.message, "error");
    $("barcodeView").classList.add("hidden");
    return;
  }

  // Request camera permission explicitly first — gives a better error message
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    stream.getTracks().forEach(t => t.stop()); // stop immediately, Html5Qrcode manages its own stream
  } catch (permErr) {
    $("barcodeView").classList.add("hidden");
    if (permErr.name === "NotAllowedError" || permErr.name === "PermissionDeniedError") {
      showToast("Camera permission denied. Go to browser Settings → Site Settings → Camera → Allow.", "error");
    } else if (permErr.name === "NotFoundError") {
      showToast("No camera found on this device.", "error");
    } else {
      showToast("Camera error: " + permErr.message, "error");
    }
    return;
  }

  // Create scanner instance inside #barcodeRegion div
  try {
    _qrScanner = new Html5Qrcode("barcodeRegion");
    $("barcodeHint").textContent = "Align barcode inside the frame...";

    const config = {
      fps: 15,
      qrbox: { width: 260, height: 120 },
      aspectRatio: 1.6,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.PDF_417,
      ],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true } // use native API if available (faster)
    };

    await _qrScanner.start(
      { facingMode: "environment" }, // rear camera
      config,
      onScanSuccess,
      onScanError  // called every frame when no code found — normal, ignore
    );
  } catch (startErr) {
    closeScanner();
    showToast("Could not start scanner: " + startErr.message, "error");
  }
}

function onScanSuccess(decodedText) {
  closeScanner();
  // Fill Serial No. field
  const serial = decodedText.trim();
  $("lSerial").value = serial;

  // Show result
  $("scanResult").classList.remove("hidden");
  $("scanResultFields").innerHTML = `
    <p><strong>Scanned:</strong> ${escapeHtml(serial)}</p>
    <p style="font-size:12px;color:var(--text-3);margin-top:3px">Serial No. field filled. Add Brand &amp; Model below.</p>
  `;

  // Beep (short audio feedback)
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 1200;
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.18);
  } catch (_) {}

  showToast("Barcode scanned — Serial No. filled!", "success");
}

function onScanError() {
  // Fires every frame when barcode not found — expected, do nothing
}

async function closeScanner() {
  if (_qrScanner) {
    try {
      const state = _qrScanner.getState();
      if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
        await _qrScanner.stop();
      }
    } catch (_) {}
    try { _qrScanner.clear(); } catch (_) {}
    _qrScanner = null;
  }
  $("barcodeView").classList.add("hidden");
}

$("clearScanBtn")?.addEventListener("click", () => {
  $("scanResult").classList.add("hidden");
  $("barcodeView").classList.add("hidden");
  closeScanner();
});

// Cleanup on page unload
window.addEventListener("pagehide", closeScanner);
window.addEventListener("beforeunload", closeScanner);
