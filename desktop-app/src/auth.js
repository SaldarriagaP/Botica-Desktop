// Modulo 1: Autenticacion (local, contra SQLite)
// TODO: expirar sesion, permisos por rol

const bcrypt = require('bcryptjs');
const { db } = require('./db');

function login(username, password, callback) {
  const sql = 'SELECT * FROM users WHERE UPPER(username) = UPPER(?)';

  db.get(sql, [username], (err, user) => {
    if (err) {
      return callback(err, { ok: false, error: 'Error interno en la base de datos' });
    }
    if (!user) {
      return callback(null, { ok: false, error: 'Usuario o contraseña incorrectos' });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return callback(null, { ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    const { password_hash, ...userSafe } = user;
    return callback(null, { ok: true, user: userSafe });
  });
}

module.exports = { login };
