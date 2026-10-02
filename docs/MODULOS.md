# Módulos del proyecto: Autenticación, Clientes y Catálogo de productos

Alcance según la *Actividad Sesión 2*: “Desarrollo de módulos para la gestión de autenticación, clientes y catálogo de productos de la cadena Boticas Solidaria”. Electron + JavaScript (Node) + SQLite + JSON de configuración.

Todas las tablas replican la estructura e IDs del MySQL del sistema web (Laravel) para que la sincronización sea un mapeo 1 a 1. Cada registro que se puede crear sin conexión guarda `central_id` (su id en el web, vacío si se creó offline) y `sync_pendiente`.

---

## 1. Autenticación

| Función | Detalle |
|---|---|
| Inicio de sesión local | Funciona sin internet. Contraseñas bcrypt compatibles con Laravel (`$2y$`): el mismo usuario y clave del web. |
| Sesión | Token aleatorio en el servidor local (solo se guarda su hash), vence por inactividad (480 min, configurable), el usuario se relee de la BD en cada petición. |
| Bloqueo | 5 intentos fallidos → 60 s bloqueado (igual que el web). Todo queda en la bitácora `auth_log`. |
| Roles y permisos | Tipos del web: 1 administrador, 2 vendedor, 3 auditor, 4 local, 5 almacén. Permisos centralizados en `src/permisos.js` (tabla abajo). |
| Gestión de usuarios (admin) | Crear, editar perfil, activar/desactivar (corta sus sesiones al instante), restablecer contraseña. No se puede desactivar a uno mismo ni dejar el sistema sin administradores. |
| Restablecer contraseña | El admin asigna una temporal → `resetPass = 1` (como el web) → al entrar, el usuario solo puede cambiarla; el resto del sistema responde 403 hasta que lo haga. |
| Cambiar mi contraseña | Pide la actual, exige que la nueva sea distinta y cierra las otras sesiones del usuario. |

### Permisos por rol

| Permiso | Admin | Vendedor | Auditor | Local | Almacén |
|---|:-:|:-:|:-:|:-:|:-:|
| Gestionar usuarios | ✔ | | | | |
| Ver clientes | ✔ | ✔ | ✔ | ✔ | ✔ |
| Registrar clientes | ✔ | ✔ | | ✔ | |
| Editar clientes | ✔ | | | ✔ | |
| Activar/desactivar clientes | ✔ | | | | |
| Ver catálogo | ✔ | ✔ | ✔ | ✔ | ✔ |
| Gestionar productos, marcas, categorías | ✔ | | | | ✔ |
| Ajustar stock / stock mínimo | ✔ | | | | ✔ |
| Ver kardex | ✔ | | ✔ | ✔ | ✔ |

> **Por validar con el gerente:** en el web el módulo “producto” también lo ve el auditor (tipo 3). En el escritorio el auditor solo consulta (catálogo y kardex), no modifica.

---

## 2. Clientes

Tabla `customers` = `customers` del web (`name`, `code`, `address`, `type`) + `tipo_documento` (códigos SUNAT), teléfono, email y estado.

- **Tipos de documento SUNAT:** 0 sin documento, 1 DNI (8 dígitos), 4 carné de extranjería, 6 RUC, 7 pasaporte.
- **RUC con dígito verificador** (módulo 11 de SUNAT) y prefijo válido (10, 15, 16, 17, 20). Un RUC mal digitado se detecta antes de guardarse.
- **Tipo de cliente automático** como el web: RUC 20 → empresa; sin documento → otros; resto → persona.
- **Documento único** (varios “sin documento” sí pueden coexistir). Al escribir el documento en el formulario avisa si ya existe y de quién es.
- **Búsqueda** por palabras del nombre en cualquier orden o por inicio del documento; paginada (7.900 clientes reales responden en ~15 ms).
- **Búsqueda exacta por documento** (`GET /api/clientes/documento/:code`) para usar en caja.
- Nombres normalizados en mayúsculas y sin espacios dobles.

---

## 3. Catálogo de productos

| Tabla local | Equivalente web |
|---|---|
| `product_brands`, `product_categories` | iguales |
| `products` | `products` (+ precio de la zona de la sucursal, que en el web está en `pricezona`) |
| `product_stock` (por producto y sucursal) | `fraccionventa` (StockCaja + StockFraccion) |
| `kardex` | movimientos de stock |

- **Fracción:** un producto puede venderse por caja (precio caja) y por unidad suelta (precio fracción). En el web el campo `status_fraccion = 1` significa **NO** se fracciona; en el escritorio se llama `se_fracciona` (sentido directo) y se convierte al sincronizar.
- **Stock en unidades mínimas (entero):** caja x 100 con 3 sueltas = 103. Se muestra como “1 caja + 3 und”. Abrir una caja no necesita lógica especial y no hay decimales.
- **Reglas del web:** marca, categoría, composición, presentación y forma farmacéutica obligatorias.
- **Reglas agregadas:**
  - vender suelto nunca puede salir más barato que la caja (`precio_fracción × fracción ≥ precio_caja`);
  - código de barras único;
  - no se puede cambiar la fracción de un producto con stock (cambiaría el significado del stock guardado);
  - advertencias (sin bloquear) si no hay precio o si se vende bajo el costo.
- **Ajustes de stock** en cajas + sueltas, con motivo obligatorio; una salida nunca deja stock negativo. **Todo cambio de stock (ajuste, venta, carga) pasa por un único punto que escribe el kardex en la misma transacción**, por eso el stock siempre cuadra con la suma del kardex (verificado sobre los 10.415 productos).
- **Stock mínimo** por sucursal con marca de “stock bajo” y filtro.
- **Búsqueda** por palabras en nombre + composición + laboratorio, o por código de barras; filtros por categoría, marca, stock (con / bajo / sin) y estado. ~30 ms sobre 10.415 productos.
- **Marcas y categorías:** alta y renombrado con nombres únicos.

---

## 4. Carga inicial desde el sistema web

```
npm run importar -- "C:\ruta\botica.sql"
```

Lee el volcado MySQL (no necesita MySQL instalado) e importa, **en una sola transacción** (si algo falla no cambia nada):

- categorías, marcas y productos (con `central_id`);
- precios de la **zona** de la sucursal configurada;
- stock de **esa sucursal** (cajas × fracción + sueltas), dejando la diferencia en el kardex como “carga desde el central”;
- clientes (si un cliente creado offline tiene el mismo documento, se enlaza en vez de duplicarse).

Se puede volver a ejecutar: actualiza sin duplicar. Resultado con el `botica.sql` real: **538 categorías, 473 marcas, 10.415 productos, 7.901 clientes en 0,9 s**.

**Hallazgo de calidad de datos en el web** (se fusionaron en el escritorio; conviene corregirlos en el web):
- Categorías 100 “TOALLITAS  HUMEDAS” y 111 “TOALLITAS HUMEDAS” (doble espacio).
- Marcas 262 “PHARMEX SAC” y 391 “PHARMEX   SAC”.
- Hay clientes sin nombre y productos con código de barras `2147483647` (desborde del campo `int` del web); estos códigos se descartan al importar.

---

## 5. Pruebas automatizadas

`npm test` → **87 pruebas, 87 OK**

| Archivo | Qué cubre |
|---|---|
| `migraciones.test.js` (9) | esquema, IDs del web, migración de bases anteriores sin pérdida, llaves foráneas |
| `auth.test.js` (21) | login, sesiones, expiración, bloqueo, hashes de Laravel, gestión de usuarios |
| `api.test.js` (12) | HTTP: 401/403, suplantación, logout, JSON de errores |
| `permisos.test.js` (6) | permisos por rol (vendedor, almacén, local), restablecer y cambiar contraseña |
| `clientes.test.js` (15) | reglas SUNAT, RUC, duplicados, búsqueda, paginación |
| `catalogo.test.js` (18) | fracciones, precios, marcas/categorías, ajustes, kardex, stock mínimo, ventas por caja/fracción |
| `importacion.test.js` (6) | lector de MySQL, precios por zona, stock por sucursal, reimportación, fusión de duplicados |
