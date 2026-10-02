# Iteración XP 1 — Autenticación local (primera entrega incremental)

Actividades 11 a 14 del plan de prácticas.

## 11. Historias seleccionadas

| ID | Historia de usuario | Criterios de aceptación | Estado |
|----|---------------------|-------------------------|--------|
| HU-01 | Como vendedor quiero iniciar sesión **sin conexión a internet** para seguir atendiendo si se cae la red. | Login contra SQLite local; no hace ninguna llamada a la red; mismo usuario/contraseña que el sistema web (hash bcrypt `$2y$` compatible). | ✅ |
| HU-02 | Como administrador quiero que cada usuario vea solo lo que su rol permite. | Roles = `user_types` del web (1 administrador, 2 vendedor, 3 auditor, 4 local, 5 almacén). El servidor valida el rol en cada petición leyendo la BD. | ✅ |
| HU-03 | Como vendedor quiero cerrar sesión para que otro compañero use la caja. | Logout revoca el token en el servidor; el token viejo deja de servir. | ✅ |
| HU-04 | Como administrador quiero que la sesión caduque si la terminal queda sin uso. | Expiración deslizante por inactividad (480 min, configurable en JSON). | ✅ |
| HU-05 | Como administrador quiero bloquear intentos de adivinar contraseñas. | 5 intentos fallidos → bloqueo de 60 s (igual que `ThrottlesLogins` del web). | ✅ |
| HU-06 | Como administrador quiero dar de alta y desactivar usuarios. | Campos del web (DNI, nombres, apellidos, rol, sucursal). Desactivar corta la sesión al instante; no se puede desactivar uno mismo ni al último admin. | ✅ |

## 12. Diseño simple

**Esquema SQLite (migración v2)** — misma estructura e IDs que el MySQL de Laravel para que la sincronización (Iteración 4) sea un mapeo 1 a 1:

- `user_types(id, name)` — 5 tipos del web.
- `locals(id, name, direccion, zona, serie, active)` — las 28 sucursales reales del dump.
- `users(id, dni, type→user_types, email, username UNIQUE NOCASE, status, firstname, lastname, direccion, fechanacimiento, phone, local→locals, resetPass, password, failed_attempts, locked_until, …)`.
- `sessions(token_hash, user_id, local_id, created_at, last_seen_at, expires_at, revoked_at, revoked_reason)` — solo se guarda el SHA-256 del token.
- `auth_log(event, username, user_id, local_id, detalle, created_at, synced)` — bitácora; la columna `synced` la usará la cola de sincronización.

**Migraciones versionadas** (`PRAGMA user_version`), cada una dentro de una transacción. Una base del prototipo anterior se migra sola conservando usuarios, contraseñas y stock (se probó con la base real; respaldo en `data/sucursal.backup-pre-iteracion1.sqlite3`).

**Durabilidad:** `journal_mode=WAL` + `synchronous=FULL` + `foreign_keys=ON` (mitiga el riesgo “pérdida de datos por corte de energía”).

**Configuración JSON:** `config/default.json` (valores de fábrica) sobrescrito por `data/config.json` de cada terminal (ej. `{"localId": 3}`) y variables de entorno.

## 13. TDD — pruebas automatizadas

`npm test` (runner nativo `node:test`, sin dependencias extra). **40 pruebas, 40 OK**:

- `test/migraciones.test.js` (7): esquema completo, IDs iguales al web, idempotencia, llaves foráneas, usuario único sin mayúsculas, migración de la base anterior sin pérdida.
- `test/auth.test.js` (21): login ADMIN01 / VEND01, mensajes genéricos, hash `$2y$` de Laravel, token hasheado, logout, expiración y renovación, bloqueo y desbloqueo, usuario desactivado, reglas de gestión de usuarios.
- `test/api.test.js` (12): HTTP real — 401 sin token, 403 para vendedor en rutas de admin, **regresión de suplantación** (`actorUsername`), logout en servidor, caja/venta a nombre del usuario de la sesión, errores siempre en JSON.

## 14. Refactorización y entrega

Defectos del prototipo corregidos en esta iteración:

1. **Suplantación de administrador:** el servidor confiaba en `actorUsername` enviado por el cliente; cualquiera podía hacerse pasar por `ADMIN01`. Ahora la identidad sale del token de sesión.
2. **Sesión solo en el navegador** (`localStorage`), sin validación, logout ni expiración en el servidor.
3. **XSS:** nombres de clientes/productos se insertaban como HTML sin escapar.
4. La API escuchaba en todas las interfaces; ahora solo en `127.0.0.1`.
5. La ventana de Electron se cerraba sin mensaje si fallaba el arranque; ahora muestra el motivo. Ventana con `sandbox`, `contextIsolation` y bloqueo de navegación externa.
6. Caja y ventas registraban el nombre de usuario que mandaba el cliente; ahora el de la sesión.

Entrega funcional: login en la app Electron con SQLite embebida poblada (usuarios `ADMIN01`/`admin123`, `VEND01`/`vendedor123`). El vendedor aterriza en **Caja** si está cerrada o en **Ventas** si ya está abierta, igual que el sistema web.

## Decisiones que afectan a iteraciones siguientes

- **La terminal de escritorio debe ser el punto de venta principal también con internet**, no solo cuando se cae. Si la venta se hace en la web y se cae la red a mitad de venta, esa venta no se puede “trasladar” al escritorio. Si siempre se vende en escritorio, la venta continúa sin interrupción y se sube al central apenas vuelve la conexión.
- **Stock “en tiempo real”:** mientras hay internet, el escritorio debe traer los cambios de stock del central seguido (no cada 2 min, sino cada pocos segundos o por notificación), para que al cortarse la red tenga el último valor (el “23” del ejemplo). Lo que se venda offline se sube como **movimientos** (−5), no como stock absoluto (18), para no pisar ventas hechas en otras cajas → reconciliación de la Iteración 5.
- Cuando se baje la tabla `users` del central, el login offline funcionará con las mismas claves del web (ya probado con hashes `$2y$`).
