# Desktop Botica

App de escritorio offline-first para que una sucursal de Boticas Solidaria
siga vendiendo aunque se caiga internet y se sincronice con el servidor
central al recuperar la conexión. Se desarrolla por iteraciones XP según el
plan de prácticas (ver `docs/`).

**Módulos del proyecto (Actividad Sesión 2): Autenticación, Clientes y
Catálogo de productos** — detalle en [docs/MODULOS.md](docs/MODULOS.md).

| Iteración | Contenido | Estado |
|-----------|-----------|--------|
| 1 | Autenticación local, esquema SQLite alineado con el web | ✅ [docs/ITERACION-1.md](docs/ITERACION-1.md) |
| — | Clientes y Catálogo completos, permisos por rol, carga inicial desde el web | ✅ [docs/MODULOS.md](docs/MODULOS.md) |
| 2 | Caja (turnos) y Clientes | pendiente |
| 3 | Catálogo/stock local y punto de venta (fracciones, IGV, kardex) | pendiente |
| 4 | Sincronización pull/push con outbox y healthcheck | pendiente |
| 5 | Rechazos del central, reconciliación de stock, estabilización | pendiente |

## Estructura

- `mock-central-server/` — servidor de prueba que simula el servidor central.
- `desktop-app/` — app de escritorio (Electron + Node + SQLite).
  - `config/default.json` — configuración de fábrica (sucursal, puerto, sesión, bloqueo).
  - `data/` — base SQLite y `config.json` propio de cada terminal (no se versiona).
  - `src/` — API local: `auth.js` (login/sesiones), `usuarios.js`, `migrations.js`, módulos de negocio.
  - `public/` — interfaz (login e interfaz principal).
  - `test/` — pruebas automatizadas.

## Cómo correrlo

Necesitas Node.js 22+.

```
cd mock-central-server && npm install && npm start     # puerto 4000
cd desktop-app && npm install && npm start              # abre la app de escritorio (Electron)
cd desktop-app && npm test                              # pruebas automatizadas
cd desktop-app && npm run importar -- ruta/botica.sql   # carga catálogo, stock y clientes del web
```

`npm run start:web` corre solo el servidor en `http://127.0.0.1:4500` para
depurar desde un navegador.

Usuarios de prueba: `ADMIN01` / `admin123` (administrador), `VEND01` / `vendedor123` (vendedor).

Para asignar la terminal a otra sucursal, crea `desktop-app/data/config.json`
con `{ "localId": 3 }` (IDs de la tabla `locals` del sistema web).

> **Nota:** `better-sqlite3` requiere Node 22+, así que la versión de
> Electron tiene que traer Node 22 o más nuevo (hoy Electron 44). Si la app
> se cierra al abrir, esa es la primera causa a revisar.
