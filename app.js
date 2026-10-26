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
  onAuthStateChanged,
  sendPasswordResetEmail
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

/* Hoy en Argentina. El día cambia a las 00:00 hora argentina. */
function hoyAR(now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
    .format(now).split("-").map(Number);
  const pad = n => String(n).padStart(2, "0");
  return { y, m, d, date: new Date(y, m - 1, d), iso: `${y}-${pad(m)}-${pad(d)}`, mes: `${y}-${pad(m)}` };
}

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

// Exponer auth globalmente para depurar en consola
window.auth = auth;

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


// UTILIDADES Y FORMATEO DE MONEDA IDÉNTICAS A MENSUALES
function formatCurrencyInput(val) {
  let clean = String(val ?? "").replace(/[^\d,]/g, "");
  const parts = clean.split(",");
  if (parts.length > 2) {
    clean = parts[0] + "," + parts.slice(1).join("");
  }
  const [integerPart, decimalPart] = clean.split(",");
  const formattedInt = (integerPart || "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (decimalPart !== undefined) {
    return `${formattedInt},${decimalPart.slice(0, 2)}`;
  }
  return formattedInt;
}

function parseCurrency(val) {
  if (val === null || val === undefined || val === "") return null;
  const cleanNumber = String(val).replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleanNumber);
  return isNaN(num) ? null : num;
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
    date: item.date || hoyAR().iso,
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
  const authMsg = $("authMessage");
  if (!authMsg) return;
  authMsg.textContent = message;
  authMsg.classList.toggle("success", success);
}

function updateAuthInterface() {
  const isLogin = authMode === "login";
  const submitBtn = $("authSubmitBtn");
  const switchBtn = $("authSwitchBtn");
  const passInput = $("authPassword");

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = isLogin ? "Iniciar sesión" : "Crear cuenta";
  }
  if (switchBtn) {
    switchBtn.textContent = isLogin
      ? "¿No tenés una cuenta? Registrate"
      : "¿Ya tenés una cuenta? Iniciá sesión";
  }
  if (passInput) {
    passInput.autocomplete = isLogin ? "current-password" : "new-password";
  }
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

$("authSwitchBtn")?.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  updateAuthInterface();
});

$("authForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const email = $("authEmail")?.value.trim();
  const password = $("authPassword")?.value;

  if (!email || !password) {
    setAuthMessage("Completá email y contraseña.");
    return;
  }

  const btn = $("authSubmitBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = authMode === "login" ? "Ingresando..." : "Creando cuenta...";
  }

  try {
    if (authMode === "register") {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    console.error("Firebase Auth Error:", error);
    setAuthMessage(firebaseErrorMessage(error));
    if (btn) btn.disabled = false;
    updateAuthInterface();
  }
});

// RECUPERACIÓN DE CONTRASEÑA
document.addEventListener("click", async (e) => {
  if (e.target && e.target.id === "forgotPasswordBtn") {
    const authEmailInput = $("authEmail");
    const email = authEmailInput?.value.trim();

    if (!email) {
      setAuthMessage("Ingresá tu correo en el campo de arriba para enviarte el enlace.");
      authEmailInput?.focus();
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      setAuthMessage(`¡Listo! Te enviamos un correo a ${email} para restablecer tu contraseña.`, true);
    } catch (error) {
      console.error("Error al enviar email de recuperación:", error);
      let errorMsg = "No se pudo enviar el correo de recuperación.";

      if (error.code === 'auth/user-not-found') {
        errorMsg = "No existe ninguna cuenta registrada con ese correo.";
      } else if (error.code === 'auth/invalid-email') {
        errorMsg = "El formato del correo electrónico no es válido.";
      } else if (error.code === 'auth/too-many-requests') {
        errorMsg = "Demasiados intentos. Esperá unos minutos antes de volver a probar.";
      }

      setAuthMessage(errorMsg);
    }
  }
});

$("logoutBtn")?.addEventListener("click", async () => {
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


// GESTIÓN DE TEMAS CON APLICACIÓN DINÁMICA DE BLUR Y OLED
function setupThemeToggles() {
  const toggleThemeBtn = $("toggleThemeBtn");
  const toggleBlueThemeBtn = $("toggleBlueThemeBtn");
  const blackThemeBtn = $("btnBlackMode");
  const savedTheme = localStorage.getItem("mensual_theme_mode") || "light";

  document.body.classList.remove("dark-mode", "dark-blue-mode", "black-mode");
  document.documentElement.classList.remove("black-mode");

  if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
    if (toggleThemeBtn) toggleThemeBtn.textContent = "☀️ Modo claro";
    if (toggleBlueThemeBtn) toggleBlueThemeBtn.textContent = "💙 Modo Azul";
    applyBlackModeInlineFixes(false);
  } else if (savedTheme === "blue") {
    document.body.classList.add("dark-blue-mode");
    if (toggleBlueThemeBtn) toggleBlueThemeBtn.textContent = "☀️ Modo claro";
    if (toggleThemeBtn) toggleThemeBtn.textContent = "🌙 Modo oscuro";
    applyBlackModeInlineFixes(false);
  } else if (savedTheme === "black") {
    document.body.classList.add("black-mode");
    document.documentElement.classList.add("black-mode");
    applyBlackModeInlineFixes(true);
  } else {
    if (toggleThemeBtn) toggleThemeBtn.textContent = "🌙 Modo oscuro";
    if (toggleBlueThemeBtn) toggleBlueThemeBtn.textContent = "💙 Modo Azul";
    applyBlackModeInlineFixes(false);
  }

  if (toggleThemeBtn) {
    toggleThemeBtn.onclick = () => {
      const isDark = document.body.classList.toggle("dark-mode");
      document.body.classList.remove("dark-blue-mode", "black-mode");
      document.documentElement.classList.remove("black-mode");
      localStorage.setItem("mensual_theme_mode", isDark ? "dark" : "light");
      toggleThemeBtn.textContent = isDark ? "☀️ Modo claro" : "🌙 Modo oscuro";
      if (toggleBlueThemeBtn) toggleBlueThemeBtn.textContent = "💙 Modo Azul";
      applyBlackModeInlineFixes(false);
    };
  }

  if (toggleBlueThemeBtn) {
    toggleBlueThemeBtn.onclick = () => {
      const isBlue = document.body.classList.toggle("dark-blue-mode");
      document.body.classList.remove("dark-mode", "black-mode");
      document.documentElement.classList.remove("black-mode");
      localStorage.setItem("mensual_theme_mode", isBlue ? "blue" : "light");
      toggleBlueThemeBtn.textContent = isBlue ? "☀️ Modo claro" : "💙 Modo Azul";
      if (toggleThemeBtn) toggleThemeBtn.textContent = "🌙 Modo oscuro";
      applyBlackModeInlineFixes(false);
    };
  }

  if (blackThemeBtn) {
    blackThemeBtn.onclick = () => {
      const isBlack = document.body.classList.toggle("black-mode");
      document.documentElement.classList.toggle("black-mode", isBlack);
      document.body.classList.remove("dark-mode", "dark-blue-mode");
      localStorage.setItem("mensual_theme_mode", isBlack ? "black" : "light");
      applyBlackModeInlineFixes(isBlack);
    };
  }
}

// CORRECCIÓN DINÁMICA POR JS (TARJETAS + BOTONES HEADER)
function applyBlackModeInlineFixes(isBlack) {
  const summaryCards = document.querySelectorAll(".summary-card, div[style*='background']");
  summaryCards.forEach(card => {
    if (isBlack) {
      if (card.style.backgroundColor === "rgb(255, 255, 255)" || card.style.backgroundColor === "white" || !card.style.backgroundColor) {
        card.style.backgroundColor = "#121212";
        card.style.color = "#ffffff";
        card.style.borderColor = "#262626";
      }
    } else {
      card.style.backgroundColor = "";
      card.style.color = "";
      card.style.borderColor = "";
    }
  });

  const headerButtons = document.querySelectorAll(".header-actions button, .header-actions a");
  headerButtons.forEach(btn => {
    if (isBlack) {
      btn.style.backgroundColor = "#1a1a1a";
      btn.style.color = "#ffffff";
      btn.style.borderColor = "#333333";

      btn.onmouseover = () => {
        btn.style.backgroundColor = "#262626";
        btn.style.borderColor = "#ffffff";
      };
      btn.onmouseout = () => {
        btn.style.backgroundColor = "#1a1a1a";
        btn.style.borderColor = "#333333";
      };
    } else {
      btn.style.backgroundColor = "";
      btn.style.color = "";
      btn.style.borderColor = "";
      btn.onmouseover = null;
      btn.onmouseout = null;
    }
  });
}

// ESTADO DE AUTENTICACIÓN
onAuthStateChanged(auth, user => {
  currentUser = user;
  setupThemeToggles();

  const authSec = $("authSection");
  const appCont = $("appContent");

  if (!user) {
    stopFirestoreSync();
    stopRecurrentes();
    expenses = [];
    if (authSec) {
      authSec.classList.remove("hidden");
      authSec.style.display = "flex";
      authSec.style.justifyContent = "center";
      authSec.style.alignItems = "center";
      authSec.style.minHeight = "100vh";
    }
    if (appCont) {
      appCont.classList.add("hidden");
      appCont.style.display = "none";
    }
    if ($("userEmail")) $("userEmail").textContent = "";
    $("authForm")?.reset();
    updateAuthInterface();
    return;
  }

  // Usuario conectado: ocultar login y mostrar app principal
  if (authSec) {
    authSec.classList.add("hidden");
    authSec.style.setProperty("display", "none", "important");
  }
  if (appCont) {
    appCont.classList.remove("hidden");
    appCont.style.setProperty("display", "block", "important");
    appCont.style.setProperty("visibility", "visible", "important");
    appCont.style.setProperty("opacity", "1", "important");
    appCont.style.setProperty("width", "100%", "important");
    appCont.style.setProperty("min-height", "100vh", "important");
  }
  if ($("userEmail")) $("userEmail").textContent = user.email || "";

  try {
    setDefaultDate();
    setupAmountsToggle();
    setupCurrencyIndicator();
    setupAmountFormatting();
    fetchDolarRate();
    startFirestoreSync();
    startRecurrentes();
  } catch (err) {
    console.error("Error al inicializar elementos de la app:", err);
  }
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

// FORMATEO EN VIVO AL ESCRIBIR EN EL INPUT MONTO
function setupAmountFormatting() {
  const amountInput = $("amount");
  if (!amountInput) return;

  amountInput.addEventListener("input", (e) => {
    const start = e.target.selectionStart;
    const prevLen = e.target.value.length;
    e.target.value = formatCurrencyInput(e.target.value);
    const newLen = e.target.value.length;
    const pos = Math.max(0, start + (newLen - prevLen));
    e.target.setSelectionRange(pos, pos);
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


// MODAL CON BLUR EXACTO AL ABRIR
function openModal() {
  if (!modal) return;
  modal.classList.add("show");

  if (document.body.classList.contains("black-mode")) {
    modal.style.backgroundColor = "rgba(0, 0, 0, 0.55)";
    modal.style.backdropFilter = "blur(10px)";
    modal.style.webkitBackdropFilter = "blur(10px)";
  }
}

function closeModal() {
  if (!modal) return;
  modal.classList.remove("show");
  modal.style.backgroundColor = "";
  modal.style.backdropFilter = "";
  modal.style.webkitBackdropFilter = "";
  expenseForm?.reset();
  if ($("expenseId")) $("expenseId").value = "";
  if ($("currency")) $("currency").value = "ARS";
  if ($("currencySymbol")) $("currencySymbol").textContent = "$";
  if ($("modalTitle")) $("modalTitle").textContent = "Agregar registro";
  setDefaultDate();
}

openModalBtn?.addEventListener("click", openModal);
emptyAddBtn?.addEventListener("click", openModal);
closeModalBtn?.addEventListener("click", closeModal);

modal?.addEventListener("click", event => {
  if (event.target === modal) closeModal();
});

function setDefaultDate() {
  const dateInput = $("date");
  if (dateInput && !dateInput.value) {
    dateInput.value = hoyAR().iso;
  }
}


// GUARDAR / EDITAR
expenseForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const id = $("expenseId")?.value;
  const typeEl = document.querySelector('input[name="type"]:checked');
  const type = typeEl ? typeEl.value : "expense";
  const description = $("description")?.value.trim() || "";
  const category = $("category")?.value || "Otros";
  const currency = $("currency") ? $("currency").value : "ARS";
  const quantity = Number($("quantity")?.value) || 1;
  const date = $("date")?.value || hoyAR().iso;
  const notes = $("notes")?.value.trim() || "";
  const amount = parseCurrency($("amount")?.value);

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

  // Conservar el vínculo con MENSUALES al editar
  if (currentExpense?.linkedMensualId) item.linkedMensualId = currentExpense.linkedMensualId;
  if (currentExpense?.linkedMonthKey) item.linkedMonthKey = currentExpense.linkedMonthKey;

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
  if (value === null || value === undefined || isNaN(value)) return "$0";
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
  const today = hoyAR().date;
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
    alimentos: "🍔",
    mascotas: "🐾",
    deudas: "💸",
    salud: "💊",
    transporte: "🚗",
    otros: "📦",
    gimnasio: "💪",
    gym: "💪",
    agua: "💧",
    alquiler: "🏠",
    local: "🏬",
    mercadería: "📦",
    mercaderia: "📦",
    cuotas: "💳",
    suscripciones: "📱"
  };
  return icons[key] || "📦";
}

function getCategoryName(category) {
  const key = String(category || "").toLowerCase();
  const names = {
    hogar: "Hogar",
    servicios: "Servicios",
    comida: "Comida",
    alimentos: "Alimentos",
    mascotas: "Mascotas",
    deudas: "Deudas",
    salud: "Salud",
    transporte: "Transporte",
    otros: "Otros",
    gimnasio: "Gimnasio",
    gym: "Gimnasio",
    agua: "Agua",
    alquiler: "Alquiler",
    local: "Local",
    mercadería: "Mercadería",
    mercaderia: "Mercadería",
    cuotas: "Cuotas",
    suscripciones: "Suscripciones"
  };
  return names[key] || "Otros";
}

function mapCategoryToMensuales(category) {
  const key = String(category || "").toLowerCase();
  const map = {
    comida: "Alimentos",
    alimentos: "Alimentos",
    transporte: "Transporte",
    hogar: "Hogar",
    servicios: "Servicios",
    salud: "Salud",
    mascotas: "Mascotas",
    deudas: "Cuotas",
    otros: "Otros",
    gimnasio: "Gimnasio",
    gym: "Gimnasio",
    agua: "Agua",
    alquiler: "Alquiler",
    local: "Local",
    mercadería: "Mercadería",
    mercaderia: "Mercadería",
    cuotas: "Cuotas",
    suscripciones: "Suscripciones"
  };
  return map[key] || "Otros";
}


// RENDER
function render() {
  try {
    updateSummary();
    renderExpenses();
    if (document.body.classList.contains("black-mode")) {
      applyBlackModeInlineFixes(true);
    }
  } catch (err) {
    console.error("Error en render:", err);
  }
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
  if (!expensesList) return;
  const filtered = getFilteredExpenses();
  expensesList.innerHTML = "";

  if (filtered.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    updateCounter(0);
    return;
  }

  if (emptyState) emptyState.style.display = "none";
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

  const amountHTML = expense.amount === null || expense.amount === undefined
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
      <h3>${escapeHTML(expense.description || "")}</h3>
      <p>${category} · Cantidad: ${expense.quantity || 1}</p>
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

  if ($("expenseId")) $("expenseId").value = expense.id;
  if ($("description")) $("description").value = expense.description || "";
  if ($("category")) $("category").value = expense.category || "";

  if ($("amount")) {
    $("amount").value = (expense.amount !== null && expense.amount !== undefined)
      ? formatCurrencyInput(String(expense.amount).replace(".", ","))
      : "";
  }

  if ($("currency")) {
    $("currency").value = expense.currency || "ARS";
    if ($("currencySymbol")) {
      $("currencySymbol").textContent = expense.currency === "USD" ? "u$s" : "$";
    }
  }
  if ($("quantity")) $("quantity").value = expense.quantity || 1;
  if ($("date")) $("date").value = expense.date || "";
  if ($("notes")) $("notes").value = expense.notes || "";

  const radio = document.querySelector(`input[name="type"][value="${expense.type}"]`);
  if (radio) radio.checked = true;

  if ($("modalTitle")) $("modalTitle").textContent = "Editar registro";
  openModal();
}

async function markAsPaid(id) {
  const expense = expenses.find(item => item.id === id);
  if (!expense) return;

  if (expense.amount === null || expense.amount <= 0) {
    alert("Para marcarlo como pagado y enviarlo a MENSUALES, tenés que definir un monto primero.");
    return;
  }

  // El pago entra en Mensuales el día en que se paga (hoy), no en la fecha de vencimiento
  const payDate = hoyAR().iso;
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

  const payDate = expense.date || hoyAR().iso;
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
  if (totalPending) totalPending.innerHTML = renderDualAmount(totalPendingARS, totalPendingUSD);

  const today = hoyAR().date;

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
  if (nextSevenDays) nextSevenDays.innerHTML = renderDualAmount(nextARS, nextUSD);

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
  if (thisMonth) thisMonth.innerHTML = renderDualAmount(monthARS, monthUSD);

  let debtsARS = 0;
  let debtsUSD = 0;
  pending
    .filter(expense => expense.type === "debt")
    .forEach(e => {
      const amt = Number(e.amount || 0);
      if (e.currency === "USD") debtsUSD += amt;
      else debtsARS += amt;
    });
  if (totalDebts) totalDebts.innerHTML = renderDualAmount(debtsARS, debtsUSD);
}

function updateCounter(count) {
  if (itemsCount) {
    itemsCount.textContent = `${count} ${count === 1 ? "registro" : "registros"}`;
  }
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


// EXPORTAR A CSV
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
      e.amount !== null && e.amount !== undefined ? e.amount : "",
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
  link.setAttribute("download", `Gastos-Proximos-${hoyAR().iso}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});


/* Dibuja la sección "GASTOS RECURRENTES" en el PDF usando los colores del tema activo.
   Devuelve la nueva posición Y. */
function recDibujarEnPDF(pdf, theme, y) {
  const hoy = hoyAR();
  const activos = recItems.filter(r => r.activo !== false);
  if (!activos.length) return y;

  const nuevaPagina = () => {
    pdf.addPage();
    if (theme.pageBg) {
      pdf.setFillColor(...theme.pageBg);
      pdf.rect(0, 0, 210, 297, "F");
    }
    return 20;
  };
  // jsPDF (helvetica) no soporta emojis: se quitan del texto
  const limpiar = s => String(s || "").replace(/[^\x20-\x7E\u00C0-\u00FF]/g, "").trim();

  if (y > 245) y = nuevaPagina();

  pdf.setTextColor(...theme.dark);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "bold");
  pdf.text("GASTOS RECURRENTES", 15, y);
  y += 4;

  const dibujarHeader = () => {
    if (theme.isBlack) pdf.setFillColor(30, 30, 30);
    else pdf.setFillColor(...theme.pink);
    pdf.rect(15, y, 180, 7, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "bold");
    pdf.text("NOMBRE", 18, y + 5);
    pdf.text("GRUPO", 75, y + 5);
    pdf.text("DIA", 105, y + 5);
    pdf.text("MONTO", 118, y + 5);
    pdf.text("ESTADO", 158, y + 5);
    y += 7;
  };
  dibujarHeader();
  pdf.setFont("helvetica", "normal");

  const orden = [...activos].sort((a, b) => {
    const ea = recEstado(a, hoy), eb = recEstado(b, hoy);
    if (ea.pagado !== eb.pagado) return ea.pagado ? 1 : -1;
    return (ea.dias ?? 0) - (eb.dias ?? 0);
  });

  orden.forEach(rec => {
    if (y > 275) {
      y = nuevaPagina();
      dibujarHeader();
      pdf.setFont("helvetica", "normal");
    }
    const est = recEstado(rec, hoy);
    const pago = rec.pagos && rec.pagos[hoy.mes];
    const monto = pago && pago.monto ? pago.monto : rec.monto;
    const montoTxt = monto ? recMoney(monto, rec.currency) : "A definir";

    pdf.setTextColor(...theme.dark);
    pdf.setFontSize(7);
    pdf.text(limpiar(rec.descripcion).slice(0, 30), 18, y + 5);
    pdf.text(recGrupoDe(rec), 75, y + 5);
    pdf.text(String(recDiaEfectivo(rec.diaVence, hoy)), 105, y + 5);
    pdf.text(montoTxt, 118, y + 5);
    pdf.text(limpiar(est.texto).slice(0, 24), 158, y + 5);

    pdf.setDrawColor(...theme.lineDivider);
    pdf.line(15, y + 8, 195, y + 8);
    y += 9;
  });

  return y;
}


// EXPORTAR PDF
$("pdfBtn")?.addEventListener("click", () => {
  if (expenses.length === 0 && recItems.length === 0) {
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

  /* COLORES DEL PDF = PALETA DE MENSUALES
     pink = color del encabezado de las tablas
     labelColor = color de los títulos chicos de las tarjetas */
  let pink, dark, light, headerBg, cardBorder, lineDivider, pageBgColor, footerColorGP, labelColor;

  if (isBlackMode) {
    pink = [20, 20, 23];
    labelColor = [255, 255, 255];
    dark = [255, 255, 255];
    light = [18, 18, 21];
    headerBg = [15, 15, 17];
    cardBorder = [31, 31, 35];
    lineDivider = [26, 26, 31];
    pageBgColor = [0, 0, 0];
    footerColorGP = [156, 163, 175];
  } else if (isBlueMode) {
    pink = [20, 36, 75];
    labelColor = [56, 189, 248];
    dark = [241, 245, 249];
    light = [15, 28, 63];
    headerBg = [15, 28, 63];
    cardBorder = [20, 36, 75];
    lineDivider = [20, 36, 75];
    pageBgColor = [7, 13, 30];
    footerColorGP = [143, 165, 202];
  } else if (isDarkMode) {
    pink = [90, 26, 42];
    labelColor = [224, 122, 133];
    dark = [245, 233, 236];
    light = [44, 20, 28];
    headerBg = [74, 17, 31];
    cardBorder = [61, 26, 36];
    lineDivider = [50, 22, 32];
    pageBgColor = [21, 10, 14];
    footerColorGP = [179, 146, 153];
  } else {
    pink = [234, 91, 142];
    labelColor = [201, 59, 110];
    dark = [82, 22, 42];
    light = [255, 231, 236];
    headerBg = [255, 176, 194];
    cardBorder = [255, 197, 210];
    lineDivider = [247, 220, 227];
    pageBgColor = null;
    footerColorGP = [141, 115, 126];
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

  const todayStr = hoyAR().date.toLocaleDateString("es-AR", {
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

    pdf.setTextColor(...labelColor);
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
    const amountStr = expense.amount !== null && expense.amount !== undefined ? formatMoney(expense.amount, curr) : "A definir";

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

  // Sección de gastos recurrentes (con los colores del tema activo)
  y = recDibujarEnPDF(pdf, {
    pink,
    dark,
    light,
    cardBorder,
    lineDivider,
    pageBg: pageBgColor,
    footerColor: footerColorGP,
    isBlack: isBlackMode
  }, y + 17);

  // Pie de página en todas las hojas
  const totalPages = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...footerColorGP);
    pdf.text("Gastos Próximos · Creado por Flor Bagnis", 15, 287);
  }

  pdf.save(`Gastos-Proximos-${hoyAR().iso}.pdf`);
});


// MOSTRAR / OCULTAR CONTRASEÑA
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
const authPasswordInput = document.getElementById('authPassword');

if (togglePasswordBtn && authPasswordInput) {
  togglePasswordBtn.addEventListener('click', () => {
    const isPassword = authPasswordInput.type === 'password';
    authPasswordInput.type = isPassword ? 'text' : 'password';
    togglePasswordBtn.textContent = isPassword ? '🌸' : '🔒';
  });
}


// ==========================================
// MOSTRAR / OCULTAR LISTA DE REGISTROS
// ==========================================
const toggleExpensesBtn = document.getElementById('toggleExpensesBtn');
const expensesContainer = document.getElementById('expensesList');

if (toggleExpensesBtn && expensesContainer) {
  // 1. Recordar si el usuario lo dejó oculto anteriormente
  const isHidden = localStorage.getItem('expensesListHidden') === 'true';
  if (isHidden) {
    expensesContainer.classList.add('expenses-hidden');
    toggleExpensesBtn.textContent = '👁️ Mostrar registros';
  }

  // 2. Alternar visibilidad al hacer clic
  toggleExpensesBtn.addEventListener('click', () => {
    expensesContainer.classList.toggle('expenses-hidden');
    const currentlyHidden = expensesContainer.classList.contains('expenses-hidden');

    toggleExpensesBtn.textContent = currentlyHidden
      ? '👁️ Mostrar registros'
      : '👁️ Ocultar registros';

    localStorage.setItem('expensesListHidden', currentlyHidden);
  });
}


/* =========================================================
   GASTOS RECURRENTES (suscripciones, servicios, impuestos...)
   Colección compartida entre las dos apps: users/{uid}/recurrentes
   Cada documento:
   { descripcion, categoria, diaVence, monto, currency, avisar, activo,
     pagos: { "2026-10": { fecha, monto, mensualId } } }
========================================================= */

const REC_GRUPOS = ["Internet", "Suscripciones", "Servicios", "Impuestos", "Alquiler", "Otros"];
const REC_ICONOS = { Internet: "🌐", Suscripciones: "📱", Servicios: "💡", Impuestos: "🏛️", Alquiler: "🏠", Otros: "📦" };
const REC_DIAS_POR_VENCER = 3;
const REC_KW_INTERNET = /\b(internet|wifi|fibertel|flow|telecentro|iplan)\b/;
const REC_KW_IMPUESTOS = /\b(impuestos?|monotributo|arba|afip|agip|abl|patente|inmobiliario|ganancias|iva|rentas)\b/;

let recItems = [];
let recUnsub = null;
let recTimer = null;


/* ---------- Lógica de fechas y estados ---------- */

function recNormalizar(s) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function recEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function recGrupoDe(rec) {
  const cat = String(rec.categoria || "").trim();
  if (cat === "Internet" || cat === "Impuestos") return cat;
  const desc = recNormalizar(rec.descripcion);
  if (REC_KW_INTERNET.test(desc)) return "Internet";
  if (REC_KW_IMPUESTOS.test(desc)) return "Impuestos";
  return REC_GRUPOS.includes(cat) ? cat : "Otros";
}

function recCategoriaMensual(rec) {
  const map = { Internet: "Servicios", Suscripciones: "Suscripciones", Servicios: "Servicios", Impuestos: "Otros", Alquiler: "Alquiler", Otros: "Otros" };
  return map[recGrupoDe(rec)] || "Otros";
}

function recDiaEfectivo(diaVence, hoy) {
  const ultimo = new Date(hoy.y, hoy.m, 0).getDate();
  return Math.min(Math.max(Number(diaVence) || 1, 1), ultimo);
}

function recDiasMensual(diaVence, hoy) {
  const venc = new Date(hoy.y, hoy.m - 1, recDiaEfectivo(diaVence, hoy));
  return Math.round((venc - hoy.date) / 86400000);
}

function recEstado(rec, hoy) {
  const pago = rec.pagos && rec.pagos[hoy.mes];
  if (pago) {
    const f = pago.fecha ? ` el ${pago.fecha.slice(8, 10)}/${pago.fecha.slice(5, 7)}` : "";
    return { clase: "paid", texto: `✅ Pagado${f}`, dias: null, pagado: true };
  }
  const dias = recDiasMensual(rec.diaVence, hoy);
  if (dias < 0) return { clase: "late", texto: `⚠️ Vencido hace ${-dias} ${dias === -1 ? "día" : "días"}`, dias, pagado: false };
  if (dias === 0) return { clase: "soon", texto: "🌸 Vence hoy", dias, pagado: false };
  if (dias === 1) return { clase: "soon", texto: "🌸 Vence mañana", dias, pagado: false };
  if (dias <= REC_DIAS_POR_VENCER) return { clase: "soon", texto: `🌸 Vence en ${dias} días`, dias, pagado: false };
  return { clase: "wait", texto: `⏳ Vence el ${recDiaEfectivo(rec.diaVence, hoy)}`, dias, pagado: false };
}

function recMoney(value, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: currency === "USD" ? "USD" : "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function recParse(val) {
  if (val === null || val === undefined || String(val).trim() === "") return null;
  const n = parseFloat(String(val).replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}


/* ---------- Firestore ---------- */

function recPayload(rec) {
  return {
    descripcion: String(rec.descripcion || "").trim(),
    categoria: rec.categoria || "Otros",
    diaVence: Number(rec.diaVence) || 1,
    monto: rec.monto === null || rec.monto === undefined || isNaN(rec.monto) ? null : Number(rec.monto),
    currency: rec.currency || "ARS",
    avisar: rec.avisar !== false,
    activo: rec.activo !== false,
    pagos: rec.pagos || {},
    createdAt: rec.createdAt || new Date().toISOString()
  };
}

async function recGuardar(rec) {
  if (!currentUser) return;
  await setDoc(doc(db, "users", currentUser.uid, "recurrentes", rec.id), recPayload(rec));
}

async function recPagar(id) {
  const rec = recItems.find(r => r.id === id);
  if (!rec || !currentUser) return;
  const hoy = hoyAR();

  let monto = rec.monto;
  if (!monto || monto <= 0) {
    const txt = prompt(`¿Cuánto pagaste de "${rec.descripcion}"?`, "");
    if (txt === null) return;
    monto = recParse(txt);
    if (!monto || monto <= 0) { alert("Ingresá un monto válido."); return; }
  }

  const mensualId = `rec-${rec.id}-${hoy.mes}`;
  const pagos = { ...(rec.pagos || {}), [hoy.mes]: { fecha: hoy.iso, monto, mensualId } };

  try {
    await recGuardar({ ...rec, pagos });

    // Lo suma como gasto en MENSUALES
    const monthRef = doc(db, "users", currentUser.uid, "months", hoy.mes);
    const snap = await getDoc(monthRef);
    let monthData = { budget: 0, expenses: [] };
    if (snap.exists()) {
      monthData = snap.data();
      if (!Array.isArray(monthData.expenses)) monthData.expenses = [];
    }
    monthData.expenses = monthData.expenses.filter(e => e.id !== mensualId);
    monthData.expenses.push({
      id: mensualId,
      date: hoy.iso,
      description: rec.descripcion,
      category: recCategoriaMensual(rec),
      amount: Number(monto),
      currency: rec.currency || "ARS"
    });
    await setDoc(monthRef, monthData, { merge: true });
  } catch (err) {
    console.error("Error al registrar pago recurrente:", err);
    alert("No se pudo registrar el pago. Revisá tu conexión e intentá de nuevo.");
  }
}

async function recDeshacerPago(id) {
  const rec = recItems.find(r => r.id === id);
  if (!rec || !currentUser) return;
  const hoy = hoyAR();
  const pago = rec.pagos && rec.pagos[hoy.mes];
  if (!pago) return;
  if (!confirm(`¿Volver "${rec.descripcion}" a pendiente y quitarlo de MENSUALES?`)) return;

  const pagos = { ...rec.pagos };
  delete pagos[hoy.mes];
  const mensualId = pago.mensualId || `rec-${rec.id}-${hoy.mes}`;

  try {
    await recGuardar({ ...rec, pagos });
    const monthRef = doc(db, "users", currentUser.uid, "months", hoy.mes);
    const snap = await getDoc(monthRef);
    if (snap.exists()) {
      const monthData = snap.data();
      if (Array.isArray(monthData.expenses)) {
        monthData.expenses = monthData.expenses.filter(e => e.id !== mensualId);
        await setDoc(monthRef, monthData, { merge: true });
      }
    }
  } catch (err) {
    console.error("Error al deshacer pago recurrente:", err);
    alert("No se pudo deshacer el pago.");
  }
}

async function recEliminar(id) {
  const rec = recItems.find(r => r.id === id);
  if (!rec || !currentUser) return;
  if (!confirm(`¿Eliminar el recurrente "${rec.descripcion}"? Los pagos ya cargados en MENSUALES no se borran.`)) return;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "recurrentes", id));
  } catch (err) {
    console.error(err);
    alert("No se pudo eliminar.");
  }
}


/* ---------- Interfaz ---------- */

function recAbrirDialog(rec = null) {
  const dlg = document.getElementById("recDialog");
  if (!dlg) return;
  document.getElementById("recFId").value = rec ? rec.id : "";
  document.getElementById("recFDesc").value = rec ? rec.descripcion || "" : "";
  document.getElementById("recFGrupo").value = rec ? recGrupoDe(rec) : "Suscripciones";
  document.getElementById("recFDia").value = rec ? rec.diaVence : hoyAR().d;
  document.getElementById("recFMonto").value = rec && rec.monto ? formatCurrencyInput(String(rec.monto).replace(".", ",")) : "";
  document.getElementById("recFMoneda").value = rec ? rec.currency || "ARS" : "ARS";
  document.getElementById("recFAvisar").checked = rec ? rec.avisar !== false : true;
  document.getElementById("recDialogTitle").textContent = rec ? "Editar recurrente" : "Agregar recurrente";
  dlg.showModal();
}

async function recSubmitForm(e) {
  e.preventDefault();
  const id = document.getElementById("recFId").value;
  const descripcion = document.getElementById("recFDesc").value.trim();
  const dia = Number(document.getElementById("recFDia").value);
  if (!descripcion) { alert("Escribí un nombre (ej: Netflix, Fibertel, Monotributo)."); return; }
  if (!dia || dia < 1 || dia > 31) { alert("El día de vencimiento tiene que estar entre 1 y 31."); return; }

  const existente = id ? recItems.find(r => r.id === id) : null;
  const rec = {
    id: id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    descripcion,
    categoria: document.getElementById("recFGrupo").value,
    diaVence: dia,
    monto: recParse(document.getElementById("recFMonto").value),
    currency: document.getElementById("recFMoneda").value,
    avisar: document.getElementById("recFAvisar").checked,
    activo: true,
    pagos: existente ? existente.pagos || {} : {},
    createdAt: existente ? existente.createdAt : new Date().toISOString()
  };

  try {
    await recGuardar(rec);
    document.getElementById("recDialog").close();
  } catch (err) {
    console.error(err);
    alert("No se pudo guardar el recurrente.");
  }
}

function recItemHTML(rec, hoy) {
  const est = recEstado(rec, hoy);
  const pago = rec.pagos && rec.pagos[hoy.mes];
  const montoMostrado = pago && pago.monto ? pago.monto : rec.monto;
  const montoTxt = montoMostrado ? recMoney(montoMostrado, rec.currency) : "Monto a definir";
  const mail = rec.avisar === false ? "" : " · 📧";
  return `
    <div class="rec-item">
      <div class="rec-info">
        <span class="rec-name">${recEsc(rec.descripcion)}</span>
        <span class="rec-meta">Día ${recDiaEfectivo(rec.diaVence, hoy)} · <span class="rec-amount">${montoTxt}</span>${mail}</span>
      </div>
      <span class="rec-badge ${est.clase}">${est.texto}</span>
      <div class="rec-actions">
        ${est.pagado
          ? `<button type="button" class="rec-icon" data-act="unpay" data-id="${rec.id}" title="Deshacer pago">↩</button>`
          : `<button type="button" class="rec-icon pay" data-act="pay" data-id="${rec.id}" title="Marcar como pagado">✓</button>`}
        <button type="button" class="rec-icon" data-act="edit" data-id="${rec.id}" title="Editar">✏️</button>
        <button type="button" class="rec-icon" data-act="delete" data-id="${rec.id}" title="Eliminar">🗑️</button>
      </div>
    </div>`;
}

function recRender() {
  const lista = document.getElementById("recList");
  if (!lista) return;
  const hoy = hoyAR();
  const activos = recItems.filter(r => r.activo !== false);

  // Cartel de aviso
  const pendientes = activos.filter(r => !recEstado(r, hoy).pagado);
  let vencidos = 0, porVencer = 0;
  pendientes.forEach(r => {
    const d = recEstado(r, hoy).dias;
    if (d < 0) vencidos++;
    else if (d <= REC_DIAS_POR_VENCER) porVencer++;
  });
  const partes = [];
  if (vencidos) partes.push(`⚠️ ${vencidos} ${vencidos === 1 ? "vencido" : "vencidos"}`);
  if (porVencer) partes.push(`🌸 ${porVencer} por vencer (${REC_DIAS_POR_VENCER} días)`);
  const banner = document.getElementById("recBanner");
  if (banner) {
    banner.textContent = partes.join(" · ");
    banner.style.display = partes.length ? "block" : "none";
    banner.className = "rec-banner" + (vencidos ? " late" : " soon");
  }

  // Resumen
  let faltaARS = 0, faltaUSD = 0;
  pendientes.forEach(r => {
    if (!r.monto) return;
    if (r.currency === "USD") faltaUSD += Number(r.monto);
    else faltaARS += Number(r.monto);
  });
  const resumen = document.getElementById("recResumen");
  if (resumen) {
    if (!activos.length) {
      resumen.textContent = "";
    } else {
      const falta = [faltaARS > 0 ? recMoney(faltaARS) : "", faltaUSD > 0 ? recMoney(faltaUSD, "USD") : ""].filter(Boolean).join(" + ") || "$0";
      resumen.innerHTML = `Pagados: <b>${activos.length - pendientes.length} de ${activos.length}</b> · Falta pagar: <b class="rec-amount">${falta}</b>`;
    }
  }

  // Lista agrupada
  if (!activos.length) {
    lista.innerHTML = `<div class="rec-empty">Todavía no cargaste recurrentes.<br>Agregá Netflix, Fibertel, el alquiler, el monotributo… y te aviso antes de que venzan.</div>`;
    return;
  }

  let html = "";
  REC_GRUPOS.forEach(g => {
    const items = activos.filter(r => recGrupoDe(r) === g);
    if (!items.length) return;
    items.sort((a, b) => {
      const ea = recEstado(a, hoy), eb = recEstado(b, hoy);
      if (ea.pagado !== eb.pagado) return ea.pagado ? 1 : -1;
      return (ea.dias ?? 0) - (eb.dias ?? 0);
    });
    html += `<div class="rec-group"><h4>${REC_ICONOS[g]} ${g}</h4>${items.map(r => recItemHTML(r, hoy)).join("")}</div>`;
  });
  lista.innerHTML = html;
}

function recMontarUI() {
  if (document.getElementById("recSection")) return;

  const style = document.createElement("style");
  style.id = "recStyles";
  style.textContent = `
    .rec-panel{margin:1.5rem 0;padding:20px;border-radius:20px;border:1px solid rgba(128,128,128,.25);background:rgba(128,128,128,.06);color:inherit;box-sizing:border-box}
    .rec-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:10px}
    .rec-head h2{margin:0;font-size:1.15rem}
    .rec-head p{margin:2px 0 0;font-size:.8rem;opacity:.75}
    .rec-head-btns{display:flex;gap:8px;flex-wrap:wrap}
    .rec-btn{background:#fbc4d4;color:#5a2337;border:1px solid #f29cb5;border-radius:12px;padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer}
    .rec-btn.ghost{background:transparent;color:inherit;border:1px solid rgba(128,128,128,.4)}
    .rec-banner{display:none;margin:8px 0;padding:10px 14px;border-radius:12px;font-weight:700;font-size:.9rem}
    .rec-banner.late{background:rgba(220,50,60,.15);color:#d32f2f}
    .rec-banner.soon{background:rgba(240,140,30,.18);color:#c26a00}
    .rec-resumen{font-size:.85rem;margin:6px 0 10px;opacity:.9}
    .rec-group h4{margin:14px 0 6px;font-size:.85rem;letter-spacing:.3px;opacity:.85}
    .rec-item{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:10px 12px;margin-bottom:6px;border-radius:14px;border:1px solid rgba(128,128,128,.2);background:rgba(128,128,128,.07)}
    .rec-info{display:flex;flex-direction:column;min-width:0}
    .rec-name{font-weight:700;overflow:hidden;text-overflow:ellipsis}
    .rec-meta{font-size:.78rem;opacity:.75}
    .rec-badge{font-size:.75rem;font-weight:700;padding:4px 10px;border-radius:999px;white-space:nowrap}
    .rec-badge.paid{background:rgba(34,160,90,.15);color:#1f8a4c}
    .rec-badge.soon{background:rgba(240,140,30,.18);color:#c26a00}
    .rec-badge.late{background:rgba(220,50,60,.15);color:#d32f2f}
    .rec-badge.wait{background:rgba(128,128,128,.15)}
    body:is(.dark-mode,.dark-blue-mode,.black-mode) .rec-badge.paid{color:#6fdc9a}
    body:is(.dark-mode,.dark-blue-mode,.black-mode) .rec-badge.soon,body:is(.dark-mode,.dark-blue-mode,.black-mode) .rec-banner.soon{color:#ffb454}
    body:is(.dark-mode,.dark-blue-mode,.black-mode) .rec-badge.late,body:is(.dark-mode,.dark-blue-mode,.black-mode) .rec-banner.late{color:#ff8a8f}
    .rec-actions{display:flex;gap:4px}
    .rec-icon{width:32px;height:32px;border-radius:50%;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;cursor:pointer;font-size:14px;display:grid;place-items:center;padding:0}
    .rec-icon.pay{background:rgba(34,160,90,.18);border-color:rgba(34,160,90,.5)}
    .rec-btn,.rec-icon{transition:background .2s,color .2s,border-color .2s,transform .15s,box-shadow .2s}
    .rec-btn:hover{background:#f29cb5;border-color:#ea5b8e;transform:translateY(-2px);box-shadow:0 6px 14px rgba(234,91,142,.3)}
    .rec-btn.ghost:hover{background:#fbc4d4;color:#5a2337;border-color:#f29cb5}
    .rec-btn:active,.rec-icon:active{transform:translateY(0) scale(.97)}
    .rec-icon:hover{background:#fbc4d4;border-color:#f29cb5;transform:scale(1.12);box-shadow:0 3px 8px rgba(234,91,142,.3)}
    .rec-icon.pay:hover{background:rgba(34,160,90,.35);border-color:rgba(34,160,90,.8)}
    .rec-item{transition:border-color .2s,background .2s}
    .rec-item:hover{border-color:#f29cb5;background:rgba(251,196,212,.18)}
    .rec-panel{--rec-text:#4a1d31;--rec-pay:#1f8a4c}
    body.dark-mode .rec-panel{--rec-text:#fdf2f6;--rec-pay:#6fdc9a}
    body.dark-blue-mode .rec-panel{--rec-text:#f1f5f9;--rec-pay:#6fdc9a}
    body.black-mode .rec-panel{--rec-text:#ffffff;--rec-pay:#6fdc9a}
    .rec-panel,.rec-panel .rec-name,.rec-panel .rec-group h4,.rec-panel .rec-head h2,.rec-panel .rec-head p,.rec-panel .rec-meta,.rec-panel .rec-resumen,.rec-panel .rec-empty{color:var(--rec-text)!important}
    .rec-panel .rec-icon{color:var(--rec-text)!important;background:transparent;opacity:1!important}
    .rec-panel .rec-icon.pay{color:var(--rec-pay)!important;background:rgba(34,160,90,.18)}
    .rec-panel .rec-btn{color:#5a2337!important}
    .rec-panel .rec-btn.ghost{color:var(--rec-text)!important}
    .rec-panel .rec-btn:hover{background:#f29cb5!important;border-color:#ea5b8e!important;color:#5a2337!important;transform:translateY(-2px);box-shadow:0 6px 14px rgba(234,91,142,.3)}
    .rec-panel .rec-btn.ghost:hover{background:#fbc4d4!important;border-color:#f29cb5!important;color:#5a2337!important}
    .rec-panel .rec-icon:hover{background:#fbc4d4!important;border-color:#f29cb5!important;color:#5a2337!important;transform:scale(1.12);box-shadow:0 3px 8px rgba(234,91,142,.3)}
    .rec-panel .rec-icon.pay:hover{background:rgba(34,160,90,.35)!important;border-color:rgba(34,160,90,.8)!important;color:#14532d!important}
    .rec-panel .rec-item:hover{border-color:#f29cb5!important;background:rgba(251,196,212,.18)!important}
    .rec-empty{text-align:center;padding:20px 10px;opacity:.75;font-size:.9rem}
    .rec-collapsed .rec-body{display:none}
    body.amounts-hidden .rec-amount{filter:blur(6px);user-select:none}
    @media (max-width:600px){.rec-item{grid-template-columns:1fr auto}.rec-badge{grid-column:1;justify-self:start}.rec-actions{grid-row:1;grid-column:2}}
    .rec-dialog{--rec-bg:#fff;--rec-fg:#333;--rec-line:#e5d3da;border:1px solid var(--rec-line);border-radius:22px;padding:24px;max-width:420px;width:92%;background:var(--rec-bg);color:var(--rec-fg)}
    body.dark-mode .rec-dialog{--rec-bg:#2a161d;--rec-fg:#ffb6c1;--rec-line:#4e2b37}
    body.dark-blue-mode .rec-dialog{--rec-bg:#0f1c3f;--rec-fg:#f1f5f9;--rec-line:#1e3a8a}
    body.black-mode .rec-dialog{--rec-bg:#121212;--rec-fg:#fff;--rec-line:#333}
    .rec-dialog::backdrop{background:rgba(0,0,0,.45);backdrop-filter:blur(6px)}
    .rec-dialog h3{margin:0 0 14px}
    .rec-dialog label{display:grid;gap:5px;font-size:.78rem;font-weight:700;margin-bottom:12px}
    .rec-dialog input[type=text],.rec-dialog input[type=number],.rec-dialog select{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid var(--rec-line);background:transparent;color:var(--rec-fg);font:inherit;font-size:.9rem}
    .rec-dialog select option{color:#333}
    .rec-row{display:grid;grid-template-columns:1fr 110px;gap:10px}
    .rec-check{display:flex!important;grid-template-columns:none!important;align-items:center;gap:8px!important;font-weight:600!important}
    .rec-check input{width:auto}
    .rec-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
    /* Colores sincronizados con cada tema */
    .rec-panel {
      --rec-accent: #e85d9e;
      --rec-accent-soft: #fce7f0;
      --rec-accent-border: #f2b5d0;
      --rec-accent-hover: #fbc4d4;
      --rec-accent-text: #5a2337;
    }

    body.dark-mode .rec-panel {
      --rec-accent: #ff78a0;
      --rec-accent-soft: #39232e;
      --rec-accent-border: #754257;
      --rec-accent-hover: #50303f;
      --rec-accent-text: #fff1f6;
    }

    body.dark-blue-mode .rec-panel {
      --rec-accent: #38bdf8;
      --rec-accent-soft: #132b49;
      --rec-accent-border: #285782;
      --rec-accent-hover: #1b3d60;
      --rec-accent-text: #e0f2fe;
    }

    body.black-mode .rec-panel {
      --rec-accent: #ffffff;
      --rec-accent-soft: #1b1b1b;
      --rec-accent-border: #444444;
      --rec-accent-hover: #292929;
      --rec-accent-text: #ffffff;
    }

    .rec-panel .rec-btn {
      background: var(--rec-accent-soft) !important;
      color: var(--rec-accent-text) !important;
      border-color: var(--rec-accent-border) !important;
    }

    .rec-panel .rec-btn.ghost {
      background: transparent !important;
      color: var(--rec-text) !important;
      border-color: var(--rec-accent-border) !important;
    }

    .rec-panel .rec-btn:hover,
    .rec-panel .rec-btn.ghost:hover {
      background: var(--rec-accent-hover) !important;
      border-color: var(--rec-accent) !important;
      color: var(--rec-accent-text) !important;
    }

    .rec-panel .rec-icon:hover {
      background: var(--rec-accent-hover) !important;
      border-color: var(--rec-accent) !important;
      color: var(--rec-accent-text) !important;
    }

    .rec-panel .rec-icon.pay:hover {
      background: rgba(34,160,90,.35) !important;
      border-color: rgba(34,160,90,.8) !important;
      color: var(--rec-pay) !important;
    }

    .rec-panel .rec-item:hover {
      border-color: var(--rec-accent-border) !important;
      background: var(--rec-accent-soft) !important;
    }
    
  `;
  document.head.appendChild(style);

  const section = document.createElement("section");
  section.id = "recSection";
  section.className = "rec-panel";
  section.innerHTML = `
    <div class="rec-head">
      <div>
        <h2>🔁 Gastos recurrentes</h2>
        <p>Suscripciones, servicios, impuestos y todo lo que se paga todos los meses. Te avisamos por mail antes de que venzan.</p>
      </div>
      <div class="rec-head-btns">
        <button type="button" class="rec-btn" id="recAddBtn">＋ Agregar recurrente</button>
        <button type="button" class="rec-btn ghost" id="recToggleBtn">▲ Ocultar</button>
      </div>
    </div>
    <div class="rec-body">
      <div id="recBanner" class="rec-banner"></div>
      <div id="recResumen" class="rec-resumen"></div>
      <div id="recList"></div>
    </div>
    <dialog id="recDialog" class="rec-dialog">
      <form id="recForm">
        <h3 id="recDialogTitle">Agregar recurrente</h3>
        <input type="hidden" id="recFId">
        <label>Nombre
          <input type="text" id="recFDesc" placeholder="Ej: Netflix, Fibertel, Monotributo" maxlength="80" required>
        </label>
        <label>Grupo
          <select id="recFGrupo">${REC_GRUPOS.map(g => `<option value="${g}">${REC_ICONOS[g]} ${g}</option>`).join("")}</select>
        </label>
        <div class="rec-row">
          <label>Monto (opcional)
            <input type="text" id="recFMonto" inputmode="decimal" placeholder="0,00">
          </label>
          <label>Moneda
            <select id="recFMoneda"><option value="ARS">ARS ($)</option><option value="USD">USD (u$s)</option></select>
          </label>
        </div>
        <label>Día del mes en que vence
          <input type="number" id="recFDia" min="1" max="31" value="10">
        </label>
        <label class="rec-check"><input type="checkbox" id="recFAvisar" checked> 📧 Avisarme por mail antes de que venza</label>
        <div class="rec-dialog-actions">
          <button type="button" class="rec-btn ghost" id="recCancelBtn">Cancelar</button>
          <button type="submit" class="rec-btn">Guardar</button>
        </div>
      </form>
    </dialog>
  `;

  // Ubicación: en Mensuales antes de "Gastos del mes"; en Próximos después del resumen
  const tabla = document.getElementById("tableContentWrapper");
  const panelGastos = tabla ? tabla.closest(".panel") : null;
  const resumenGrid = document.querySelector(".summary-grid");
  if (panelGastos && panelGastos.parentNode) {
    panelGastos.parentNode.insertBefore(section, panelGastos);
  } else if (resumenGrid) {
    resumenGrid.insertAdjacentElement("afterend", section);
  } else {
    (document.getElementById("appContent") || document.body).appendChild(section);
  }

  // Eventos
  document.getElementById("recAddBtn").addEventListener("click", () => recAbrirDialog());
  document.getElementById("recCancelBtn").addEventListener("click", () => document.getElementById("recDialog").close());
  document.getElementById("recForm").addEventListener("submit", recSubmitForm);
  document.getElementById("recFMonto").addEventListener("input", e => {
    const start = e.target.selectionStart;
    const prevLen = e.target.value.length;
    e.target.value = formatCurrencyInput(e.target.value);
    const pos = Math.max(0, start + (e.target.value.length - prevLen));
    e.target.setSelectionRange(pos, pos);
  });
  document.getElementById("recList").addEventListener("click", e => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === "pay") recPagar(id);
    if (btn.dataset.act === "unpay") recDeshacerPago(id);
    if (btn.dataset.act === "edit") recAbrirDialog(recItems.find(r => r.id === id));
    if (btn.dataset.act === "delete") recEliminar(id);
  });

  // Ocultar / mostrar (recuerda la elección)
  const toggleBtn = document.getElementById("recToggleBtn");
  let colapsado = false;
  try { colapsado = localStorage.getItem("recurrentes_collapsed") === "true"; } catch (e) {}
  const aplicarColapso = () => {
    section.classList.toggle("rec-collapsed", colapsado);
    toggleBtn.textContent = colapsado ? "▼ Mostrar" : "▲ Ocultar";
  };
  aplicarColapso();
  toggleBtn.addEventListener("click", () => {
    colapsado = !colapsado;
    try { localStorage.setItem("recurrentes_collapsed", colapsado); } catch (e) {}
    aplicarColapso();
  });

  // Que los estados cambien solos a las 00:00 hora argentina
  if (!recTimer) recTimer = setInterval(recRender, 60000);
}

function startRecurrentes() {
  stopRecurrentes();
  if (!currentUser) return;
  recMontarUI();
  recUnsub = onSnapshot(
    collection(db, "users", currentUser.uid, "recurrentes"),
    snapshot => {
      recItems = [];
      snapshot.forEach(d => recItems.push({ id: d.id, ...d.data() }));
      recRender();
    },
    err => console.error("Error al sincronizar recurrentes:", err)
  );
}

function stopRecurrentes() {
  if (typeof recUnsub === "function") { recUnsub(); recUnsub = null; }
  recItems = [];
  recRender();
}
