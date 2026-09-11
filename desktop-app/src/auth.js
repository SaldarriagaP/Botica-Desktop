// Modulo 1: Autenticacion (local, contra SQLite)
// TODO: expirar sesion, permisos por rol

const bcrypt = require('bcryptjs');
const { db } = require('./db');

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE UPPER(username) = UPPER(?)').get(username);
  if (!user) return { ok: false, error: 'Usuario o contraseña incorrectos' };
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return { ok: false, error: 'Usuario o contraseña incorrectos' };
  }
  const { password_hash, ...userSafe } = user;
  return { ok: true, user: userSafe };
}

module.exports = { login };
