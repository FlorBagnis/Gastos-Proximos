/* ==========================================
   GASTOS PRÓXIMOS
   INTEGRACIÓN BIDIRECCIONAL CON MENSUALES + DÓLARES + MODO BLACK + ALERTAS + CSV + BUSCADOR
========================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// Credenciales del proyecto unificado
const firebaseConfig = {
  apiKey: "AIzaSyBGGfMzmGfRH614IT5wwG2kZOtUDBd16ok",
  authDomain: "mensuales-8de3d.firebaseapp.com",
  projectId: "mensuales-8de3d",
  storageBucket: "mensuales-8de3d.firebasestorage.app",
  messagingSenderId: "248967622199",
  appId: "1:248967622199:web:86e53f1b115e974bb8d9b2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let expenses = [];
let currentFilter = "all";
let searchQuery = "";
let authMode = "login";
let unsubscribeExpenses = null;

const $ = id => document.getElementById(id);


// ELEMENTOS DEL DOM
const modal = $("modal");
const openModalBtn = $("openModalBtn");
const emptyAddBtn = $("emptyAddBtn");
const closeModalBtn = $("closeModalBtn");
const expenseForm = $("expenseForm");
const expensesList = $("expensesList");
const emptyState = $("emptyState");

const totalPending = $("totalPending");
const nextSevenDays = $("nextSevenDays");
const thisMonth = $("thisMonth");
const totalDebts = $("totalDebts");
const itemsCount = $("itemsCount");


// REGISTRO DE SERVICE WORKER (PWA)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(err => console.log("SW error:", err));
  });
}


// FIRESTORE SYNC
function getExpensesCollectionRef() {
  if (!currentUser) return null;
  return collection(db, "users", currentUser.uid, "proximos");
}

function startFirestoreSync() {
  stopFirestoreSync();
  const colRef = getExpensesCollectionRef();
  if (!colRef) return;

  unsubscribeExpenses = onSnapshot(colRef, snapshot => {
    expenses = [];
    snapshot.forEach(docSnap => {
      expenses.push({ id: docSnap.id, ...docSnap.data() });
    });
    render();
  }, error => {
    console.error("Error en Firestore:", error);
  });
}

function stopFirestoreSync() {
  if (typeof unsubscribeExpenses === "function") {
    unsubscribeExpenses();
    unsubscribeExpenses = null;
  }
}

async function saveExpenseToFirestore(item) {
  if (!currentUser) return;
  const docRef = doc(db, "users", currentUser.uid, "proximos", item.id);

  const payload = {
    type: item.type || "expense",
    description: item.description || "",
    category: item.category || "otros",
    amount: item.amount === null || isNaN(item.amount) ? null : Number(item.amount),
    currency: item.currency || "ARS",
    quantity: Number(item.quantity) || 1,
    date: item.date || new Date().toISOString().slice(0, 10),
    notes: item.notes || "",
    paid: Boolean(item.paid),
    createdAt: item.createdAt || new Date().toISOString()
  };

  if (item.linkedMensualId) payload.linkedMensualId = item.linkedMensualId;
  if (item.linkedMonthKey) payload.linkedMonthKey = item.linkedMonthKey;

  await setDoc(docRef, payload, { merge: true });
}

async function deleteExpenseFromFirestore(id) {
  if (!currentUser) return;
  const docRef = doc(db, "users", currentUser.uid, "proximos", id);
  await deleteDoc(docRef);
}


// COTIZACIÓN DÓLAR EN VIVO
async function fetchDolarRate() {
  const badge = $("dolarBadge");
  if (!badge) return;
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/blue");
    const data = await res.json();
    if (data?.venta) {
      badge.textContent = `💵 Blue Venta: $${data.venta}`;
    }
  } catch (err) {
    badge.textContent = `💵 Dólar Blue: no disponible`;
  }
}


// AUTENTICACIÓN
function setAuthMessage(message, success = false) {
  $("authMessage").textContent = message;
  $("authMessage").classList.toggle("success", success);
}

function updateAuthInterface() {
  const isLogin = authMode === "login";
  $("authSubmitBtn").disabled = false;
  $("authSubmitBtn").textContent = isLogin ? "Iniciar sesión" : "Crear cuenta";
  $("authSwitchBtn").textContent = isLogin
    ? "¿No tenés una cuenta? Registrate"
    : "¿Ya tenés una cuenta? Iniciá sesión";
  $("authPassword").autocomplete = isLogin ? "current-password" : "new-password";
  setAuthMessage("");
}

function firebaseErrorMessage(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-email": "El email no es válido.",
    "auth/missing-password": "Ingresá una contraseña.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese email.",
    "auth/invalid-credential": "El email o la contraseña son incorrectos.",
    "auth/user-not-found": "No existe una cuenta con ese email.",
    "auth/wrong-password": "La contraseña es incorrecta.",
    "auth/too-many-requests": "Demasiados intentos. Esperá un momento.",
    "auth/network-request-failed": "No hay conexión con Firebase."
  };
  return messages[code] || `Error (${code || "desconocido"}). Volvé a intentar.`;
}

$("authSwitchBtn").addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  updateAuthInterface();
});

$("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    setAuthMessage("Completá email y contraseña.");
    return;
  }

  const btn = $("authSubmitBtn");
  btn.disabled = true;
  btn.textContent = authMode === "login" ? "Ingresando..." : "Creando cuenta...";

  try {
    if (authMode === "register") {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    console.error("Firebase Auth Error:", error);
    setAuthMessage(firebaseErrorMessage(error));
    btn.disabled = false;
    updateAuthInterface();
  }
});

$("logoutBtn").addEventListener("click", async () => {
  const confirmed = confirm("¿Querés cerrar sesión?");
  if (!confirmed) return;

  try {
    stopFirestoreSync();
    await signOut(auth);
  } catch (error) {
    console.error("Error al salir:", error);
    alert("No se pudo cerrar la sesión.");
  }
});


// GESTIÓN DE TEMAS (CLARO, OSCURO, AZUL Y BLACK)
function setupThemeToggles() {
  const toggleThemeBtn = $("toggleThemeBtn");
  const toggleBlueThemeBtn = $("toggleBlueThemeBtn");
  const blackThemeBtn = $("btnBlackMode");
  const savedTheme = localStorage.getItem("mensual_theme_mode") || "light";

  document.body.classList.remove("dark-mode", "dark-blue-mode", "black-mode");

  if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
    if (toggleThemeBtn) toggleThemeBtn.textContent = "☀️ Modo claro";
    if (toggleBlueThemeBtn) toggleBlueThemeBtn.textContent = "💙 Modo Azul";
  } else if (savedTheme === "blue") {
    document.body.classList.add("dark-blue-mode");
    if (toggleBlueThemeBtn) toggleBlueThemeBtn.textContent = "☀️ Modo claro";
    if (toggleThemeBtn) toggleThemeBtn.textContent = "🌙 Modo oscuro";
  } else if (savedTheme === "black") {
    document.body.classList.add("black-mode");
  } else {
    if (toggleThemeBtn) toggleThemeBtn.textContent = "🌙 Modo oscuro";
    if (toggleBlueThemeBtn) toggleBlueThemeBtn.textContent = "💙 Modo Azul";
  }

  if (toggleThemeBtn) {
    toggleThemeBtn.onclick = () => {
      const isDark = document.body.classList.toggle("dark-mode");
      document.body.classList.remove("dark-blue-mode", "black-mode");
      localStorage.setItem("mensual_theme_mode", isDark ? "dark" : "light");
      toggleThemeBtn.textContent = isDark ? "☀️ Modo claro" : "🌙 Modo oscuro";
      if (toggleBlueThemeBtn) toggleBlueThemeBtn.textContent = "💙 Modo Azul";
    };
  }

  if (toggleBlueThemeBtn) {
    toggleBlueThemeBtn.onclick = () => {
      const isBlue = document.body.classList.toggle("dark-blue-mode");
      document.body.classList.remove("dark-mode", "black-mode");
      localStorage.setItem("mensual_theme_mode", isBlue ? "blue" : "light");
      toggleBlueThemeBtn.textContent = isBlue ? "☀️ Modo claro" : "💙 Modo Azul";
      if (toggleThemeBtn) toggleThemeBtn.textContent = "🌙 Modo oscuro";
    };
  }

  if (blackThemeBtn) {
    blackThemeBtn.onclick = () => {
      const isBlack = document.body.classList.toggle("black-mode");
      document.body.classList.remove("dark-mode", "dark-blue-mode");
      localStorage.setItem("mensual_theme_mode", isBlack ? "black" : "light");
    };
  }
}

onAuthStateChanged(auth, user => {
  currentUser = user;
  setupThemeToggles();

  if (!user) {
    stopFirestoreSync();
    expenses = [];
    $("authSection").classList.remove("hidden");
    $("appContent").classList.add("hidden");
    $("userEmail").textContent = "";
    $("authForm").reset();
    updateAuthInterface();
    return;
  }

  $("authSection").classList.add("hidden");
  $("appContent").classList.remove("hidden");
  $("userEmail").textContent = user.email || "";

  setDefaultDate();
  setupAmountsToggle();
  setupCurrencyIndicator();
  fetchDolarRate();
  startFirestoreSync();
});


// SÍMBOLO DINÁMICO SEGÚN SELECTOR
function setupCurrencyIndicator() {
  const curSelect = $("currency");
  const curSymbol = $("currencySymbol");
  if (!curSelect || !curSymbol) return;

  curSelect.addEventListener("change", () => {
    curSymbol.textContent = curSelect.value === "USD" ? "u$s" : "$";
  });
}


// OCULTAR / MOSTRAR MONTOS
function setupAmountsToggle() {
  const toggleAmountsBtn = $("toggleAmountsBtn");
  if (!toggleAmountsBtn) return;

  const isHidden = localStorage.getItem("gastos_proximos_hide_amounts") === "true";

  if (isHidden) {
    document.body.classList.add("amounts-hidden");
    toggleAmountsBtn.textContent = "👁️ Mostrar montos";
  } else {
    document.body.classList.remove("amounts-hidden");
    toggleAmountsBtn.textContent = "👁️ Ocultar montos";
  }

  toggleAmountsBtn.onclick = () => {
    const hidden = document.body.classList.toggle("amounts-hidden");
    localStorage.setItem("gastos_proximos_hide_amounts", hidden);
    toggleAmountsBtn.textContent = hidden ? "👁️ Mostrar montos" : "👁️ Ocultar montos";
  };
}

// MODAL LIMPIO
function openModal() {
  modal.classList.add("show");
}

  // Si estamos en modo black, forzamos los estilos inline en los elementos difíciles
  if (document.body.classList.contains("black-mode")) {
    const modalContent = modal.querySelector(".modal-content, .modal-box, dialog") || modal.firstElementChild;
    if (modalContent) {
      modalContent.style.backgroundColor = "#121212";
      modalContent.style.color = "#ffffff";
      modalContent.style.borderColor = "#262626";
    }
    
    // Forzar el fondo oscuro y texto blanco en los selectores de tipo (Gasto próximo / Deuda)
    modal.querySelectorAll("label, div[style*='background'], fieldset, span, p, h3").forEach(el => {
      el.style.backgroundColor = "#1a1a1a";
      el.style.color = "#ffffff";
      el.style.borderColor = "#333333";
    });
  }
}

// GUARDAR / EDITAR
expenseForm.addEventListener("submit", async event => {
  event.preventDefault();

  const id = $("expenseId").value;
  const type = document.querySelector('input[name="type"]:checked').value;
  const description = $("description").value.trim();
  const category = $("category").value;
  const amountValue = $("amount").value;
  const currency = $("currency") ? $("currency").value : "ARS";
  const quantity = Number($("quantity").value) || 1;
  const date = $("date").value;
  const notes = $("notes").value.trim();
  const amount = amountValue === "" ? null : Number(amountValue);

  const currentExpense = id ? expenses.find(e => e.id === id) : null;

  const item = {
    id: id || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    description,
    category,
    amount,
    currency,
    quantity,
    date,
    notes,
    paid: currentExpense ? currentExpense.paid : false,
    createdAt: currentExpense ? currentExpense.createdAt : new Date().toISOString()
  };

  try {
    await saveExpenseToFirestore(item);
    closeModal();
  } catch (error) {
    console.error("Error al guardar en Firestore:", error);
    alert("No se pudo guardar el registro en la nube.");
  }
});


// FORMATEADORES & MAPEOS
function formatMoney(value, currency = "ARS") {
  if (value === null || value === undefined || isNaN(value)) return null;
  const isUSD = currency === "USD";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: isUSD ? "USD" : "ARS",
    maximumFractionDigits: isUSD ? 2 : 0
  }).format(value);
}

function renderDualAmount(arsAmount, usdAmount) {
  if (usdAmount > 0 && arsAmount > 0) {
    return `${formatMoney(arsAmount)} <small style="display:block; font-size:0.8rem; font-weight:normal; color:#e85d9e;">${formatMoney(usdAmount, "USD")}</small>`;
  }
  if (usdAmount > 0) {
    return formatMoney(usdAmount, "USD");
  }
  return formatMoney(arsAmount);
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short"
  }).format(date);
}

function getDueAlert(dateString, isPaid) {
  if (isPaid || !dateString) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateString}T00:00:00`);
  const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { text: "⚠️ Vencido", style: "background:#ffebee; color:#d32f2f; border:1px solid #ffcdd2;" };
  }
  if (diffDays === 0) {
    return { text: "⏰ Vence hoy", style: "background:#fff3e0; color:#e65100; border:1px solid #ffe0b2;" };
  }
  if (diffDays <= 2) {
    return { text: "⚡ Próximo", style: "background:#fce4ec; color:#c2185b; border:1px solid #f8bbd0;" };
  }
  return null;
}

function getCategoryIcon(category) {
  const key = String(category || "").toLowerCase();
  const icons = {
    hogar: "🏠",
    servicios: "💡",
    comida: "🍔",
    mascotas: "🐾",
    deudas: "💸",
    salud: "💊",
    transporte: "🚗",
    otros: "📦",
    gimnasio: "💪",
    gym: "💪",
    agua: "💧"
  };
  return icons[key] || "📦";
}

function getCategoryName(category) {
  const key = String(category || "").toLowerCase();
  const names = {
    hogar: "Hogar",
    servicios: "Servicios",
    comida: "Comida",
    mascotas: "Mascotas",
    deudas: "Deudas",
    salud: "Salud",
    transporte: "Transporte",
    otros: "Otros",
    gimnasio: "Gimnasio",
    gym: "Gimnasio",
    agua: "Agua"
  };
  return names[key] || "Otros";
}

function mapCategoryToMensuales(category) {
  const key = String(category || "").toLowerCase();
  const map = {
    comida: "Alimentos",
    transporte: "Transporte",
    hogar: "Hogar",
    servicios: "Servicios",
    salud: "Salud",
    mascotas: "Mascotas",
    deudas: "Otros",
    otros: "Otros",
    gimnasio: "Gimnasio",
    gym: "Gimnasio",
    agua: "Agua"
  };
  return map[key] || "Otros";
}


// RENDER
function render() {
  updateSummary();
  renderExpenses();
}

function getFilteredExpenses() {
  let filtered = [...expenses];

  if (currentFilter === "pending") {
    filtered = filtered.filter(e => !e.paid);
  } else if (currentFilter === "paid") {
    filtered = filtered.filter(e => e.paid);
  } else if (currentFilter === "debt") {
    filtered = filtered.filter(e => e.type === "debt");
  }

  if (searchQuery.trim() !== "") {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(e => 
      (e.description || "").toLowerCase().includes(q) ||
      (e.notes || "").toLowerCase().includes(q) ||
      getCategoryName(e.category).toLowerCase().includes(q)
    );
  }

  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
  return filtered;
}

function renderExpenses() {
  const filtered = getFilteredExpenses();
  expensesList.innerHTML = "";

  if (filtered.length === 0) {
    emptyState.style.display = "block";
    updateCounter(0);
    return;
  }

  emptyState.style.display = "none";
  filtered.forEach(expense => {
    expensesList.appendChild(createExpenseElement(expense));
  });

  updateCounter(filtered.length);
}

function createExpenseElement(expense) {
  const article = document.createElement("article");
  article.className = "expense";

  const icon = getCategoryIcon(expense.category);
  const category = getCategoryName(expense.category);
  const curr = expense.currency || "ARS";

  const amountHTML = expense.amount === null
    ? `<span class="no-amount">Monto pendiente</span>`
    : `<strong>${formatMoney(expense.amount, curr)}</strong>`;

  const statusClass = expense.paid ? "paid" : expense.type === "debt" ? "debt" : "pending";
  const statusText = expense.paid ? "Pagado" : expense.type === "debt" ? "Deuda" : "Pendiente";

  const dueAlert = getDueAlert(expense.date, expense.paid);
  const alertHTML = dueAlert 
    ? `<span class="badge" style="${dueAlert.style}; margin-left: 6px; font-weight: bold;">${dueAlert.text}</span>` 
    : "";

  article.innerHTML = `
    <div class="expense-icon">${icon}</div>

    <div class="expense-info">
      <h3>${escapeHTML(expense.description)}</h3>
      <p>${category} · Cantidad: ${expense.quantity}</p>
      ${expense.notes ? `<p>${escapeHTML(expense.notes)}</p>` : ""}
      <div style="margin-top: 4px;">
        <span class="badge ${statusClass}">${statusText}</span>
        ${alertHTML}
      </div>
    </div>

    <div class="expense-date">
      Pagar
      <strong>${formatDate(expense.date)}</strong>
    </div>

    <div class="expense-amount">
      ${amountHTML}
      <div class="actions">
        ${
          !expense.paid
            ? `<button class="action-button pay" title="Marcar como pagado y enviar a MENSUALES" data-action="pay" data-id="${expense.id}">✓</button>`
            : `<button class="action-button unpay" title="Volver a pendiente y quitar de MENSUALES" data-action="unpay" data-id="${expense.id}">✖</button>`
        }
        <button class="action-button" title="Editar" data-action="edit" data-id="${expense.id}">✏️</button>
        <button class="action-button delete" title="Eliminar" data-action="delete" data-id="${expense.id}">🗑️</button>
      </div>
    </div>
  `;

  article.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "pay") markAsPaid(id);
      if (action === "unpay") markAsUnpaid(id);
      if (action === "edit") editExpense(id);
      if (action === "delete") deleteExpense(id);
    });
  });

  return article;
}


// BUSCADOR EN VIVO
$("searchInput")?.addEventListener("input", e => {
  searchQuery = e.target.value;
  renderExpenses();
});


// ACCIONES
function editExpense(id) {
  const expense = expenses.find(item => item.id === id);
  if (!expense) return;

  $("expenseId").value = expense.id;
  $("description").value = expense.description;
  $("category").value = expense.category;
  $("amount").value = expense.amount === null ? "" : expense.amount;
  if ($("currency")) {
    $("currency").value = expense.currency || "ARS";
    if ($("currencySymbol")) {
      $("currencySymbol").textContent = expense.currency === "USD" ? "u$s" : "$";
    }
  }
  $("quantity").value = expense.quantity;
  $("date").value = expense.date;
  $("notes").value = expense.notes || "";

  const radio = document.querySelector(`input[name="type"][value="${expense.type}"]`);
  if (radio) radio.checked = true;

  $("modalTitle").textContent = "Editar registro";
  openModal();
}

async function markAsPaid(id) {
  const expense = expenses.find(item => item.id === id);
  if (!expense) return;

  if (expense.amount === null || expense.amount <= 0) {
    alert("Para marcarlo como pagado y enviarlo a MENSUALES, tenés que definir un monto primero.");
    return;
  }

  const payDate = expense.date || new Date().toISOString().slice(0, 10);
  const monthKey = payDate.slice(0, 7);
  const mensualId = `gp-${expense.id}`;

  expense.paid = true;
  expense.linkedMensualId = mensualId;
  expense.linkedMonthKey = monthKey;
  await saveExpenseToFirestore(expense);

  const monthDocRef = doc(db, "users", currentUser.uid, "months", monthKey);

  try {
    const docSnap = await getDoc(monthDocRef);
    let monthData = { budget: 0, expenses: [] };

    if (docSnap.exists()) {
      monthData = docSnap.data();
      if (!Array.isArray(monthData.expenses)) monthData.expenses = [];
    }

    const newMensualExpense = {
      id: mensualId,
      date: payDate,
      description: expense.description,
      category: mapCategoryToMensuales(expense.category),
      amount: Number(expense.amount),
      currency: expense.currency || "ARS"
    };

    monthData.expenses = monthData.expenses.filter(e => e.id !== mensualId);
    monthData.expenses.push(newMensualExpense);

    await setDoc(monthDocRef, monthData, { merge: true });
    alert(`✓ Pago registrado y sumado a MENSUALES (${monthKey})`);
  } catch (error) {
    console.error("Error al transferir a MENSUALES:", error);
    alert("Se marcó como pagado, pero hubo un error al sincronizar con MENSUALES.");
  }
}

async function markAsUnpaid(id) {
  const expense = expenses.find(item => item.id === id);
  if (!expense) return;

  const payDate = expense.date || new Date().toISOString().slice(0, 10);
  const monthKey = expense.linkedMonthKey || payDate.slice(0, 7);
  const mensualId = expense.linkedMensualId || `gp-${expense.id}`;

  expense.paid = false;
  await saveExpenseToFirestore(expense);

  try {
    const monthDocRef = doc(db, "users", currentUser.uid, "months", monthKey);
    const docSnap = await getDoc(monthDocRef);

    if (docSnap.exists()) {
      const monthData = docSnap.data();
      if (Array.isArray(monthData.expenses)) {
        monthData.expenses = monthData.expenses.filter(e => e.id !== mensualId);
        await setDoc(monthDocRef, monthData, { merge: true });
      }
    }
    alert("↩ Registro vuelto a pendiente y quitado de MENSUALES.");
  } catch (error) {
    console.error("Error al remover de MENSUALES:", error);
    alert("Se volvió a pendiente, pero hubo un error al quitarlo de MENSUALES.");
  }
}

async function deleteExpense(id) {
  const expense = expenses.find(item => item.id === id);
  if (!expense) return;

  const confirmed = confirm(`¿Querés eliminar "${expense.description}"?`);
  if (!confirmed) return;

  await deleteExpenseFromFirestore(id);
}


// RESUMEN CON DESGLOSE DUAL (ARS / USD)
function updateSummary() {
  const pending = expenses.filter(expense => !expense.paid);

  let totalPendingARS = 0;
  let totalPendingUSD = 0;
  pending.forEach(e => {
    const amt = Number(e.amount || 0);
    if (e.currency === "USD") totalPendingUSD += amt;
    else totalPendingARS += amt;
  });
  totalPending.innerHTML = renderDualAmount(totalPendingARS, totalPendingUSD);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sevenDays = new Date(today);
  sevenDays.setDate(sevenDays.getDate() + 7);

  let nextARS = 0;
  let nextUSD = 0;
  pending
    .filter(expense => {
      const date = new Date(`${expense.date}T00:00:00`);
      return date >= today && date <= sevenDays;
    })
    .forEach(e => {
      const amt = Number(e.amount || 0);
      if (e.currency === "USD") nextUSD += amt;
      else nextARS += amt;
    });
  nextSevenDays.innerHTML = renderDualAmount(nextARS, nextUSD);

  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  let monthARS = 0;
  let monthUSD = 0;
  pending
    .filter(expense => {
      const date = new Date(`${expense.date}T00:00:00`);
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    })
    .forEach(e => {
      const amt = Number(e.amount || 0);
      if (e.currency === "USD") monthUSD += amt;
      else monthARS += amt;
    });
  thisMonth.innerHTML = renderDualAmount(monthARS, monthUSD);

  let debtsARS = 0;
  let debtsUSD = 0;
  pending
    .filter(expense => expense.type === "debt")
    .forEach(e => {
      const amt = Number(e.amount || 0);
      if (e.currency === "USD") debtsUSD += amt;
      else debtsARS += amt;
    });
  totalDebts.innerHTML = renderDualAmount(debtsARS, debtsUSD);
}

function updateCounter(count) {
  itemsCount.textContent = `${count} ${count === 1 ? "registro" : "registros"}`;
}

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    currentFilter = button.dataset.filter;
    renderExpenses();
  });
});

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// ==========================================
// EXPORTAR A CSV (EXCEL / SHEETS)
// ==========================================
$("csvBtn")?.addEventListener("click", () => {
  if (expenses.length === 0) {
    alert("No hay registros para exportar.");
    return;
  }

  const rows = [
    ["Fecha", "Concepto", "Categoría", "Tipo", "Estado", "Monto", "Moneda", "Cantidad", "Notas"]
  ];

  const sorted = [...expenses].sort((a, b) => new Date(a.date) - new Date(b.date));

  sorted.forEach(e => {
    rows.push([
      e.date || "",
      `"${(e.description || "").replace(/"/g, '""')}"`,
      getCategoryName(e.category),
      e.type === "debt" ? "Deuda" : "Gasto",
      e.paid ? "Pagado" : "Pendiente",
      e.amount !== null ? e.amount : "",
      e.currency || "ARS",
      e.quantity || 1,
      `"${(e.notes || "").replace(/"/g, '""')}"`
    ]);
  });

  const csvContent = "\uFEFF" + rows.map(r => r.join(";")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Gastos-Proximos-${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});


// ==========================================
// EXPORTAR REPORTE A PDF (SOPORTE MODO BLACK)
// ==========================================
$("pdfBtn")?.addEventListener("click", () => {
  if (expenses.length === 0) {
    alert("No hay registros para exportar.");
    return;
  }

  if (!window.jspdf) {
    alert("No se pudo cargar la librería para generar el PDF.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });

  const isDarkMode = document.body.classList.contains("dark-mode");
  const isBlueMode = document.body.classList.contains("dark-blue-mode");
  const isBlackMode = document.body.classList.contains("black-mode");

  let pink, dark, light, headerBg, cardBorder, lineDivider, pageBgColor, footerColorGP;

  if (isBlackMode) {
    pink = [255, 255, 255];
    dark = [241, 245, 249];
    light = [18, 18, 18];
    headerBg = [10, 10, 10];
    cardBorder = [40, 40, 40];
    lineDivider = [30, 30, 30];
    pageBgColor = [0, 0, 0];
    footerColorGP = [150, 150, 150];
  } else if (isBlueMode) {
    pink = [56, 189, 248];
    dark = [241, 245, 249];
    light = [15, 28, 63];
    headerBg = [7, 13, 30];
    cardBorder = [30, 53, 109];
    lineDivider = [20, 36, 75];
    pageBgColor = [7, 13, 30];
    footerColorGP = [143, 165, 202];
  } else if (isDarkMode) {
    pink = [255, 120, 160];
    dark = [240, 240, 240];
    light = [45, 35, 40];
    headerBg = [55, 30, 45];
    cardBorder = [80, 45, 60];
    lineDivider = [50, 35, 42];
    pageBgColor = [25, 20, 25];
    footerColorGP = [200, 150, 170];
  } else {
    pink = [232, 93, 158];
    dark = [51, 41, 52];
    light = [255, 240, 247];
    headerBg = [255, 227, 240];
    cardBorder = [240, 223, 232];
    lineDivider = [245, 230, 238];
    pageBgColor = null;
    footerColorGP = [160, 140, 150];
  }

  if (pageBgColor) {
    pdf.setFillColor(...pageBgColor);
    pdf.rect(0, 0, 210, 297, "F");
  }

  pdf.setFillColor(...headerBg);
  pdf.roundedRect(15, 15, 180, 26, 4, 4, "F");

  pdf.setTextColor(...dark);
  pdf.setFontSize(16);
  pdf.setFont("helvetica", "bold");
  pdf.text("AGENDA DE GASTOS PROXIMOS", 21, 26);

  const todayStr = new Date().toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.text(`Reporte emitido el ${todayStr}`, 21, 33);

  const pendingItems = expenses.filter(e => !e.paid);

  let totalPendingARS = 0;
  let totalPendingUSD = 0;
  let debtsARS = 0;
  let debtsUSD = 0;

  pendingItems.forEach(e => {
    const amt = Number(e.amount || 0);
    if (e.currency === "USD") {
      totalPendingUSD += amt;
      if (e.type === "debt") debtsUSD += amt;
    } else {
      totalPendingARS += amt;
      if (e.type === "debt") debtsARS += amt;
    }
  });

  const strPending = totalPendingUSD > 0 ? `${formatMoney(totalPendingARS)} + ${formatMoney(totalPendingUSD, "USD")}` : formatMoney(totalPendingARS);
  const strDebts = debtsUSD > 0 ? `${formatMoney(debtsARS)} + ${formatMoney(debtsUSD, "USD")}` : formatMoney(debtsARS);

  const cards = [
    ["PENDIENTE TOTAL", strPending],
    ["DEUDAS", strDebts],
    ["ITEMS PENDIENTES", `${pendingItems.length}`]
  ];

  cards.forEach((card, index) => {
    const x = 15 + index * 60;
    pdf.setDrawColor(...cardBorder);
    pdf.roundedRect(x, 46, 56, 22, 3, 3, "S");

    pdf.setTextColor(...pink);
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "bold");
    pdf.text(card[0], x + 4, 53);

    pdf.setTextColor(...dark);
    pdf.setFontSize(9);
    pdf.text(card[1], x + 4, 62);
  });

  let y = 76;
  if (isBlackMode) {
    pdf.setFillColor(30, 30, 30);
  } else {
    pdf.setFillColor(...pink);
  }
  pdf.rect(15, y, 180, 7, "F");

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(7);
  pdf.setFont("helvetica", "bold");
  pdf.text("FECHA", 18, y + 5);
  pdf.text("CONCEPTO / DETALLE", 42, y + 5);
  pdf.text("CATEGORÍA", 115, y + 5);
  pdf.text("ESTADO", 145, y + 5);
  pdf.text("MONTO", 170, y + 5);

  y += 7;
  pdf.setFont("helvetica", "normal");

  const sortedExpenses = [...expenses].sort((a, b) => new Date(a.date) - new Date(b.date));

  sortedExpenses.forEach(expense => {
    if (y > 275) {
      pdf.addPage();
      if (pageBgColor) {
        pdf.setFillColor(...pageBgColor);
        pdf.rect(0, 0, 210, 297, "F");
      }
      y = 20;
    }

    const state = expense.paid ? "Pagado" : expense.type === "debt" ? "Deuda" : "Pendiente";
    const curr = expense.currency || "ARS";
    const amountStr = expense.amount !== null ? formatMoney(expense.amount, curr) : "A definir";

    pdf.setTextColor(...dark);
    pdf.setFontSize(7);
    pdf.text(formatDate(expense.date), 18, y + 5);
    pdf.text(String(expense.description || "").slice(0, 38), 42, y + 5);
    pdf.text(getCategoryName(expense.category), 115, y + 5);
    pdf.text(state, 145, y + 5);
    pdf.text(amountStr, 170, y + 5);

    pdf.setDrawColor(...lineDivider);
    pdf.line(15, y + 8, 195, y + 8);
    y += 9;
  });

  if (y > 265) {
    pdf.addPage();
    if (pageBgColor) {
      pdf.setFillColor(...pageBgColor);
      pdf.rect(0, 0, 210, 297, "F");
    }
    y = 20;
  }

  pdf.setFillColor(...light);
  pdf.rect(15, y, 180, 9, "F");
  pdf.setTextColor(...dark);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  pdf.text("TOTAL PENDIENTE DE PAGO", 18, y + 6);
  pdf.text(strPending, 150, y + 6);

  pdf.setFontSize(7);
  pdf.setTextColor(...footerColorGP);
  pdf.text("Gastos Próximos · Creado por Flor Bagnis", 15, 287);

  pdf.save(`Gastos-Proximos-${new Date().toISOString().slice(0, 10)}.pdf`);
});


// Mostrar / Ocultar contraseña
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
const authPasswordInput = document.getElementById('authPassword');

if (togglePasswordBtn && authPasswordInput) {
  togglePasswordBtn.addEventListener('click', () => {
    const isPassword = authPasswordInput.type === 'password';
    authPasswordInput.type = isPassword ? 'text' : 'password';
    togglePasswordBtn.textContent = isPassword ? '🌸' : '🔒';
  });
}
