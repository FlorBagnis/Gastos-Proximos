# 🌸 Gastos Próximos · Organización de pagos y deudas

<p align="center">
  <img width="100%" alt="Preview Gastos Próximos" src="https://github.com/user-attachments/assets/70dc562e-5702-449e-8b65-656afe139283" />
</p>

> **Gastos Próximos** es una aplicación web minimalista e intuitiva para registrar, recordar y organizar compromisos de pago futuros, deudas pendientes y compras planificadas. Se integra en tiempo real con **[MENSUALES](https://github.com/florbagnis/Mensuales)** bajo el mismo ecosistema financiero.

---

## ✨ Funcionalidades

### 🔐 Cuenta de usuario
* Registro e inicio de sesión con correo electrónico y contraseña mediante **Firebase Authentication**.
* Recuperación de contraseña y cierre de sesión.
* Datos aislados de forma segura por identificador único (`UID`).


### 🎨 Sistema Multi-Tema
Selección fluida de interfaz con persistencia en `localStorage`:
* 🌸 **Modo Claro / Pastel:** Estética limpia y suave por defecto.
* 🌙 **Modo Oscuro (Dark Pink):** Tonos oscuros con contrastes fucsia/rosados.
* 💙 **Modo Azul Profundo:** Interfaz descansada en gama azul noche.
* 🖤 **Modo Black (OLED):** Contraste puro en `#121212` optimizado para pantallas OLED y ahorro de batería.


### 💰 Resumen financiero dinámico
* **Total pendiente:** Suma acumulada de todos los compromisos que restan pagar.
* **Próximos 7 días:** Cálculo en tiempo real de los pagos que vencen en la semana entrante.
* **Este mes:** Total de pagos comprometidos para el mes calendario en curso.
* **Deudas:** Acumulado monetario de todas las obligaciones clasificadas como deuda.

### 🧾 Gestión de registros
Cada registro incluye:
* 🏷️ **Tipo:** Gasto próximo (facturas, compras) o Deuda (préstamos, dinero adeudado).
* 📝 **Descripción:** Concepto detallado de la obligación.
* 📂 **Categoría:** Clasificación temática con selector visual.
* 💵 **Monto:** Importe asignado (moneda ARS o USD).
* 🔢 **Cantidad:** Unidades o ítems asociados.
* 📅 **Fecha:** Día exacto pactado o límite para realizar el pago.
* 📌 **Nota:** Aclaraciones adicionales o contexto del compromiso.

**Acciones disponibles:**
* ✏️ **Editar registros:** Modificar importes, fechas o notas preexistentes.
* ✓ **Marcar como pagado:** Actualiza el estado al instante y lo transfiere al balance mensual correspondiente.
* 🗑️ **Eliminar registros:** Borrado individual con confirmación previa.
* ➕ **Carga rápida:** Formulario modal accesible desde el encabezado o la pantalla vacía.

### 🔍 Filtros interactivos
Visualización segmentada en un clic:
* **Todos:** Listado completo ordenado cronológicamente por fecha de vencimiento.
* **Pendientes:** Únicamente compromisos no abonados.
* **Deudas:** Registros catalogados formalmente como deudas.
* **Pagados:** Historial de obligaciones ya saldadas.

### 👁️ Modo privacidad
Enmascara cifras con `••••••` en tarjetas de resumen y en el listado para visualizaciones en público o capturas de pantalla, conservando la preferencia en el navegador.

---

## 🌸 Ecosistema Integrado con "MENSUALES"

Ambas aplicaciones operan sincronizadas mediante **Firebase Authentication** y **Cloud Firestore**:

* 🔗 **Navegación directa:** Barra superior que permite alternar entre **MENSUALES** y **Gastos Próximos** sin recargas ni pérdida de sesión.
* 🔄 **Sincronización en tiempo real:** Al marcar un ítem como pagado en *Gastos Próximos*, impacta de forma automática en el mes activo de *MENSUALES*, clasificando el egreso con su respectiva categoría, descripción y moneda.

---

## 📄 Exportación de Reportes en PDF

<p align="center">
  <img width="100%" alt="Exportación PDF" src="https://github.com/user-attachments/assets/9b9565f4-4a01-4f19-87fb-be5f92a8d8fe" />
</p>

Generación de reportes descargables en formato PDF mediante la librería **jsPDF**:
* Tarjetas de resumen: **Total Pendiente**, **Total en Deudas** y balance por pagar.
* Tabla cronológica detallada con fecha, concepto, categoría, estado y monto.
* Cálculo del total final de compromisos pendientes para control impreso o archivo contable.

---

## 🛠️ Tecnologías Utilizadas

* **Frontend:** HTML5, CSS3 (Flexbox, CSS Grid, Variables nativas), JavaScript (Vanilla ES6 Modules).
* **BaaS / Backend:** Firebase v12 (Authentication & Cloud Firestore en tiempo real).
* **Librerías:** jsPDF.
* **Deploy & Control de Versiones:** Git, GitHub, Vercel.

---

## 🗄️ Estructura de Datos en Firestore

Los registros se encuentran estructurados bajo el `UID` de cada usuario:

```text
users/
└── {UID}/
    └── proximos/
        └── {itemId}/
            ├── description: string
            ├── amount: number
            ├── currency: "ARS" | "USD"
            ├── category: string
            ├── type: "gasto" | "deuda"
            ├── date: string
            ├── notes: string
            ├── paid: boolean
            └── createdAt: timestamp


Plaintext
gastos-proximos/
│
├── index.html       <- Maquetación, modales y vistas
├── app.js           <- Lógica de negocio, Firestore y eventos
├── style.css        <- Estilos visuales y diseño responsive
└── README.md        <- Documentación técnica

```

👩‍💻 Autora

**Florencia Bagnis**

* 💼 [LinkedIn](https://www.linkedin.com/in/florencia-bagnis-5043aa152/)
* 💻 [Portfolio](https://florbagnis.github.io/Portfolio-FlorBagnis/)
* 📧 [florenciasoledadbagnis@gmail.com](mailto:florenciasoledadbagnis@gmail.com)
