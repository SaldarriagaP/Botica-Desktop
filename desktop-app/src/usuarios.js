// Gestion de usuarios locales (solo administrador).
// Mismos campos que la tabla users del sistema web. En la Iteracion 4 el
// central pasa a ser la fuente de verdad y estos datos se sincronizan.

const bcrypt = require('bcryptjs');
const { db } = require('./db');
const config = require('./config');
const auth = require('./auth');

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const ahora = () => new Date().toISOString();

function listar() {
  return db.prepare(`${auth.SELECT_USUARIO} ORDER BY u.username`).all().map((u) => ({
    ...auth.perfilPublico(u),
    status: u.status,
    phone: u.phone,
    bloqueado: !!(u.locked_until && u.locked_until > ahora()),
  }));
}

function listarTipos() {
  return db.prepare('SELECT id, name FROM user_types ORDER BY id').all();
}

function listarLocales({ soloActivos = false } = {}) {
  const where = soloActivos ? 'WHERE active = 1' : '';
  return db.prepare(`SELECT id, name, direccion, serie, active FROM locals ${where} ORDER BY name`).all();
}

// Valida los datos de perfil (todo menos usuario y contrasena).
function validarPerfil(datos) {
  const d = {
    dni: texto(datos.dni),
    firstname: texto(datos.firstname),
    lastname: texto(datos.lastname),
    email: texto(datos.email),
    phone: texto(datos.phone),
    type: Number(datos.type),
    local: datos.local === undefined || datos.local === '' || datos.local === null ? config.localId : Number(datos.local),
  };

  if (!d.firstname || !d.dni) return { ok: false, error: 'DNI y nombres son obligatorios' };
  if (!/^\d{8}$/.test(d.dni)) return { ok: false, error: 'El DNI debe tener 8 dígitos' };
  if (d.firstname.length > 60 || d.lastname.length > 60) return { ok: false, error: 'Nombres y apellidos: máximo 60 caracteres' };
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return { ok: false, error: 'El email no es válido' };
  if (d.phone && !/^\d{6,9}$/.test(d.phone)) return { ok: false, error: 'El teléfono debe tener de 6 a 9 dígitos' };
  if (!db.prepare('SELECT 1 FROM user_types WHERE id = ?').get(d.type)) return { ok: false, error: 'Rol inválido' };
  if (!db.prepare('SELECT 1 FROM locals WHERE id = ?').get(d.local)) return { ok: false, error: 'Sucursal inválida' };

  return { ok: true, datos: d };
}

function crear(datos) {
  datos = datos || {};
  const username = texto(datos.username);
  const password = typeof datos.password === 'string' ? datos.password : '';

  if (!username || !password) return { ok: false, error: 'Usuario y contraseña son obligatorios' };
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
    return { ok: false, error: 'El usuario debe tener de 3 a 30 caracteres (letras, números, punto, guion)' };
  }
  if (password.length < 6) return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres' };

  const v = validarPerfil(datos);
  if (!v.ok) return v;
  const d = v.datos;

  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return { ok: false, error: 'Ya existe un usuario con ese nombre de usuario' };
  }

  const info = db.prepare(
    `INSERT INTO users (dni, type, email, username, status, firstname, lastname, phone, local, password)
     VALUES (?,?,?,?,1,?,?,?,?,?)`
  ).run(d.dni, d.type, d.email, username, d.firstname, d.lastname, d.phone, d.local,
    bcrypt.hashSync(password, config.auth.bcryptRounds));
  return { ok: true, id: Number(info.lastInsertRowid) };
}

function adminsActivos() {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE type = ? AND status = 1').get(auth.TIPO_ADMIN).n;
}

// Edita el perfil (el nombre de usuario no cambia: es la llave con el web).
function actualizar(id, datos, actor) {
  id = Number(id);
  const actual = db.prepare('SELECT id, type, status FROM users WHERE id = ?').get(id);
  if (!actual) return { ok: false, error: 'Usuario no encontrado' };

  const v = validarPerfil(datos || {});
  if (!v.ok) return v;
  const d = v.datos;

  const pierdeAdmin = actual.type === auth.TIPO_ADMIN && d.type !== auth.TIPO_ADMIN;
  if (pierdeAdmin && actor && actor.id === id) return { ok: false, error: 'No puedes quitarte a ti mismo el rol de administrador' };
  if (pierdeAdmin && actual.status === 1 && adminsActivos() <= 1) {
    return { ok: false, error: 'Debe quedar al menos un administrador activo' };
  }

  db.prepare(
    `UPDATE users SET dni = ?, firstname = ?, lastname = ?, email = ?, phone = ?, type = ?, local = ?, updated_at = ?
     WHERE id = ?`
  ).run(d.dni, d.firstname, d.lastname, d.email, d.phone, d.type, d.local, ahora(), id);
  return { ok: true };
}

function cambiarEstado(id, estado, actor) {
  id = Number(id);
  const activar = estado === 1 || estado === true || estado === '1';
  const user = db.prepare('SELECT id, type, status FROM users WHERE id = ?').get(id);
  if (!user) return { ok: false, error: 'Usuario no encontrado' };

  if (!activar) {
    if (actor && actor.id === id) return { ok: false, error: 'No puedes desactivar tu propio usuario' };
    if (user.type === auth.TIPO_ADMIN && user.status === 1 && adminsActivos() <= 1) {
      return { ok: false, error: 'Debe quedar al menos un administrador activo' };
    }
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(activar ? 1 : 0, ahora(), id);
    if (!activar) auth.revocarSesionesDeUsuario(id, 'usuario_desactivado');
  })();
  return { ok: true };
}

function restablecerPassword(id, temporal, actor) {
  if (actor && actor.id === Number(id)) {
    return { ok: false, error: 'Para tu propia contraseña usa "Cambiar mi contraseña"' };
  }
  return auth.restablecerPassword(Number(id), temporal);
}

module.exports = { listar, listarTipos, listarLocales, crear, actualizar, cambiarEstado, restablecerPassword };
