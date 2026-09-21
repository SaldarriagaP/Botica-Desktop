// Modulo 1: Autenticacion (local, contra SQLite)
// TODO: expirar sesion

const bcrypt = require('bcryptjs');
const { db } = require('./db');

const ROLES = ['admin', 'vendedor'];

function login(username, password) {
  if (!username || !password) {
    return { ok: false, error: 'Ingresa usuario y contraseña' };
  }
  const user = db.prepare('SELECT * FROM users WHERE UPPER(username) = UPPER(?)').get(username.trim());
  if (!user) return { ok: false, error: 'Usuario o contraseña incorrectos' };
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return { ok: false, error: 'Usuario o contraseña incorrectos' };
  }
  if (!user.estado) {
    return { ok: false, error: 'Este usuario está inactivo. Contacta al administrador.' };
  }
  const { password_hash, ...userSafe } = user;
  return { ok: true, user: userSafe };
}

// Vuelve a leer el rol desde la BD en vez de confiar en lo que mande el
// cliente, para que un usuario no pueda "hacerse admin" editando el request.
function esAdminActivo(username) {
  if (!username) return false;
  const user = db.prepare('SELECT rol, estado FROM users WHERE UPPER(username) = UPPER(?)').get(username.trim());
  return !!user && user.rol === 'admin' && user.estado === 1;
}

function listar() {
  return db.prepare('SELECT id, username, nombre, email, rol, estado FROM users ORDER BY username').all();
}

function crear({ username, password, nombre, email, rol }) {
  username = (username || '').trim();
  nombre = (nombre || '').trim();
  email = (email || '').trim();
  rol = rol || 'vendedor';

  if (!username || !password || !nombre) {
    return { ok: false, error: 'Usuario, contraseña y nombre son obligatorios' };
  }
  if (password.length < 6) {
    return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres' };
  }
  if (!ROLES.includes(rol)) {
    return { ok: false, error: 'Rol inválido' };
  }

  const existe = db.prepare('SELECT id FROM users WHERE UPPER(username) = UPPER(?)').get(username);
  if (existe) return { ok: false, error: 'Ya existe un usuario con ese nombre de usuario' };

  const info = db.prepare(
    'INSERT INTO users (username, password_hash, nombre, email, rol, estado) VALUES (?,?,?,?,?,1)'
  ).run(username, bcrypt.hashSync(password, 10), nombre, email, rol);
  return { ok: true, id: info.lastInsertRowid };
}

function cambiarEstado(id, estado) {
  const info = db.prepare('UPDATE users SET estado = ? WHERE id = ?').run(estado ? 1 : 0, id);
  if (info.changes === 0) return { ok: false, error: 'Usuario no encontrado' };
  return { ok: true };
}

module.exports = { login, esAdminActivo, listar, crear, cambiarEstado, ROLES };
