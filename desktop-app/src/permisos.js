// Permisos por tipo de usuario (un solo lugar, como ModuleAccessMiddleware
// del sistema web). Tipos: 1 administrador, 2 vendedor, 3 auditor,
// 4 local (encargado de sucursal), 5 almacen.

const TODOS = [1, 2, 3, 4, 5];

const PERMISOS = {
  'usuarios.gestionar': [1],

  'clientes.ver': TODOS,
  'clientes.crear': [1, 2, 4], // el vendedor da de alta al cliente en caja
  'clientes.editar': [1, 4],
  'clientes.estado': [1],

  'catalogo.ver': TODOS,
  'catalogo.gestionar': [1, 5], // productos, marcas y categorias
  'catalogo.stock': [1, 5], // ajustes de stock y stock minimo
  'catalogo.kardex': [1, 3, 4, 5],
};

function tiene(tipo, permiso) {
  const permitidos = PERMISOS[permiso];
  if (!permitidos) throw new Error(`Permiso desconocido: ${permiso}`);
  return permitidos.includes(tipo);
}

function listarDe(tipo) {
  return Object.keys(PERMISOS).filter((p) => PERMISOS[p].includes(tipo));
}

module.exports = { PERMISOS, tiene, listarDe };
