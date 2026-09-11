# Desktop Botica (prototipo inicial)

App de escritorio para que una sucursal de Botica Solidaria pueda vender
localmente y sincronizarse con un servidor central. Primer avance: los
módulos básicos funcionando, todavía falta pulir varias cosas.

## Estructura

- `mock-central-server/` — servidor de prueba que simula el servidor central
  (catálogo + recepción de ventas).
- `desktop-app/` — app de escritorio (Electron + Node + SQLite).

## Módulos (6, versión básica)

1. **Autenticación** — login local contra usuarios en SQLite.
2. **Caja** — abrir/cerrar turno.
3. **Ventas** — punto de venta simple (agregar productos, registrar venta).
4. **Clientes** — listar y crear clientes.
5. **Catálogo / stock** — ver productos y su stock.
6. **Sincronización** — botón manual para traer catálogo y subir ventas
   pendientes al servidor central.

## Cómo correrlo

Necesitas Node.js 18+.

```
cd mock-central-server && npm install && npm start     # puerto 4000
cd desktop-app && npm install && npm start              # puerto 4500 (Electron)
```

`npm run start:web` dentro de `desktop-app` lo corre en el navegador
(`http://localhost:4500`) sin abrir Electron.

Usuarios de prueba: `ADMIN01` / `admin123`, `VEND01` / `vendedor123`.

## Pendiente

- Manejo de errores y validaciones.
- Sincronización automática (hoy es manual).
- Fracciones de producto, IGV, boleta/factura.
- Historial de turnos de caja.
- Permisos por rol.
