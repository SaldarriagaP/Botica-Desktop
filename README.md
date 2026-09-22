# Desktop Botica (prototipo inicial)

App de escritorio para que una sucursal de Botica Solidaria pueda vender
localmente y sincronizarse con un servidor central. Primer avance: los
módulos básicos funcionando, todavía falta pulir varias cosas.

## Estructura

- `mock-central-server/` — servidor de prueba que simula el servidor central
  (catálogo + recepción de ventas).
- `desktop-app/` — app de escritorio (Electron + Node + SQLite).

## Módulos (6, versión básica)

1. **Autenticación** — login local contra usuarios en SQLite, con usuarios
   activos/inactivos, cerrar sesión (para cambiar de usuario) y gestión de
   usuarios (alta y activar/desactivar, solo admin).
2. **Caja** — abrir/cerrar turno, con validación de montos.
3. **Ventas** — punto de venta simple (agregar productos, registrar venta).
   El servidor vuelve a leer precio y stock desde la base de datos al
   registrar la venta (no confía en lo que mande la ventana) y la
   descuenta dentro de una transacción, para que no se pueda vender más
   stock del que hay ni manipular el precio desde el navegador.
4. **Clientes** — listar, crear y editar clientes, con tipo/número de
   documento validado (DNI 8 dígitos, RUC 11) y estado activo/inactivo.
5. **Catálogo / stock** — ver, crear y editar productos (categoría, marca,
   código de barras único, stock mínimo con aviso de stock bajo) y
   activar/desactivar productos.
6. **Sincronización** — botón manual para traer catálogo y subir ventas
   pendientes al servidor central.

Las acciones de administración (gestionar usuarios, editar/desactivar
clientes y productos) están restringidas al rol `admin`; el servidor
revalida el rol contra la base de datos en cada request, no confía en lo
que mande el cliente.

## Cómo correrlo

Necesitas Node.js 18+.

```
cd mock-central-server && npm install && npm start     # puerto 4000
cd desktop-app && npm install && npm start              # abre la app de escritorio (Electron)
```

`npm start` en `desktop-app` es el modo normal: abre una ventana nativa
(sin barra de menú de navegador) en vez de un navegador. Internamente
sigue usando un servidor Express local (puerto 4500) para hablar con la
base de datos SQLite, pero eso es un detalle interno; para el usuario es
una app de escritorio.

`npm run start:web` dentro de `desktop-app` corre solo el servidor y lo
deja disponible en `http://localhost:4500` para abrirlo en un navegador
normal — útil para depurar, pero no es el modo pensado para el usuario
final.

Usuarios de prueba: `ADMIN01` / `admin123`, `VEND01` / `vendedor123`.

> **Nota:** `better-sqlite3` requiere Node 22+, así que la versión de
> Electron en `devDependencies` tiene que ser una que traiga por dentro
> Node 22 o más nuevo (hoy usamos Electron 44). Si en el futuro se baja
> la versión de Electron y la app truena sin ningún mensaje al abrir la
> ventana, esa es la primera causa a revisar.

## Pendiente

- Sincronización automática (hoy es manual).
- Fracciones de producto, IGV, boleta/factura.
- Historial de turnos de caja.
- Permisos por rol más finos (por ahora solo admin/vendedor).
- Recuperación de contraseña.
