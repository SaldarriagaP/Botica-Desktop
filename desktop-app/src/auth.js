// Modulo 1: Autenticacion 100% local (no depende de la red).
//
// - Verifica usuario/contrasena contra SQLite. Los hashes son bcrypt, el
//   mismo formato que usa Laravel ($2y$10$...), asi que cuando la Iteracion 4
//   baje los usuarios del central, cada vendedor entra con su misma clave.
// - Crea una sesion en el servidor local: el navegador solo guarda un token
//   aleatorio; en la BD se guarda su hash SHA-256, nunca el token en claro.
// - Cada request vuelve a leer al usuario de la BD (rol y estado), asi que
//   desactivar a alguien corta su sesion de inmediato.
// - Bloqueo temporal tras N intentos fallidos (como ThrottlesLogins del web).
// - Todo intento queda en auth_log (se subira al central en la Iteracion 4).

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const config = require('./config');
const permisos = require('./permisos');

const TIPO_ADMIN = 1;
const MSG_CREDENCIALES = 'Usuario o contraseña incorrectos';
const MSG_INACTIVO = 'Este usuario está inactivo. Contacta al administrador.';

// Hash de relleno: si el usuario no existe igual se hace un compare de bcrypt,
// para que el tiempo de respuesta no delate que usuarios existen.
const HASH_RELLENO = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), config.auth.bcryptRounds);

// Reloj inyectable para poder probar expiraciones y bloqueos sin esperar.
let reloj = () => new Date();
function _setReloj(fn) {
  reloj = fn || (() => new Date());
}

const iso = (fecha) => fecha.toISOString();
const masMs = (fecha, ms) => new Date(fecha.getTime() + ms);
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const idleMs = () => config.session.idleMinutes * 60 * 1000;

const SELECT_USUARIO = `
  SELECT u.*, t.name AS type_name, l.name AS local_name
  FROM users u
  JOIN user_types t ON t.id = u.type
  LEFT JOIN locals l ON l.id = u.local`;

function perfilPublico(u) {
  return {
    id: u.id,
    username: u.username,
    dni: u.dni,
    email: u.email,
    firstname: u.firstname,
    lastname: u.lastname,
    nombre: `${u.firstname} ${u.lastname}`.trim(),
    type: u.type,
    rol: u.type_name,
    esAdmin: u.type === TIPO_ADMIN,
    local: u.local,
    localNombre: u.local_name || null,
    resetPass: !!u.resetPass,
    permisos: permisos.listarDe(u.type),
  };
}

function registrarEvento(event, { username = null, userId = null, detalle = null } = {}) {
  db.prepare(
    'INSERT INTO auth_log (event, username, user_id, local_id, detalle, created_at) VALUES (?,?,?,?,?,?)'
  ).run(event, username, userId, config.localId, detalle, iso(reloj()));
}

function segundosRestantes(hastaIso, ahora) {
  return Math.max(1, Math.ceil((new Date(hastaIso).getTime() - ahora.getTime()) / 1000));
}

function login(username, password) {
  username = typeof username === 'string' ? username.trim() : '';
  if (!username || typeof password !== 'string' || !password) {
    return { ok: false, error: 'Ingresa usuario y contraseña' };
  }

  const ahora = reloj();
  const user = db.prepare(`${SELECT_USUARIO} WHERE u.username = ?`).get(username);

  if (!user) {
    bcrypt.compareSync(password, HASH_RELLENO);
    registrarEvento('login_fallido', { username, detalle: 'usuario inexistente' });
    return { ok: false, error: MSG_CREDENCIALES };
  }

  if (user.locked_until && user.locked_until > iso(ahora)) {
    const seg = segundosRestantes(user.locked_until, ahora);
    registrarEvento('login_bloqueado', { username: user.username, userId: user.id });
    return { ok: false, error: `Demasiados intentos fallidos. Espera ${seg} segundos e intenta de nuevo.`, bloqueadoSegundos: seg };
  }

  if (!bcrypt.compareSync(password, user.password)) {
    const intentos = user.failed_attempts + 1;
    if (intentos >= config.auth.maxAttempts) {
      const hasta = iso(masMs(ahora, config.auth.lockoutSeconds * 1000));
      db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?').run(hasta, user.id);
      registrarEvento('login_bloqueado', { username: user.username, userId: user.id, detalle: `${intentos} intentos fallidos` });
      const seg = config.auth.lockoutSeconds;
      return { ok: false, error: `Demasiados intentos fallidos. Espera ${seg} segundos e intenta de nuevo.`, bloqueadoSegundos: seg };
    }
    db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(intentos, user.id);
    registrarEvento('login_fallido', { username: user.username, userId: user.id, detalle: `intento ${intentos}` });
    return { ok: false, error: MSG_CREDENCIALES };
  }

  if (user.status !== 1) {
    registrarEvento('login_inactivo', { username: user.username, userId: user.id });
    return { ok: false, error: MSG_INACTIVO };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expira = iso(masMs(ahora, idleMs()));

  db.transaction(() => {
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
    db.prepare(
      `INSERT INTO sessions (token_hash, user_id, local_id, created_at, last_seen_at, expires_at)
       VALUES (?,?,?,?,?,?)`
    ).run(hashToken(token), user.id, config.localId, iso(ahora), iso(ahora), expira);
    registrarEvento('login_ok', { username: user.username, userId: user.id });
  })();

  return { ok: true, token, expiraEn: expira, user: perfilPublico(user) };
}

function revocar(sesionId, motivo) {
  db.prepare('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL')
    .run(iso(reloj()), motivo, sesionId);
}

// Devuelve { sesionId, user } si el token es valido; null si no.
// La expiracion es por inactividad: cada uso la extiende (sesion deslizante).
function validarSesion(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;

  const sesion = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
  if (!sesion || sesion.revoked_at) return null;

  const ahora = reloj();
  if (sesion.expires_at <= iso(ahora)) {
    revocar(sesion.id, 'expirada');
    registrarEvento('sesion_expirada', { userId: sesion.user_id });
    return null;
  }

  const user = db.prepare(`${SELECT_USUARIO} WHERE u.id = ?`).get(sesion.user_id);
  if (!user || user.status !== 1) {
    revocar(sesion.id, 'usuario_inactivo');
    return null;
  }

  // Extiende la sesion como maximo una vez cada 30 s para no escribir en
  // disco en cada request.
  if (ahora.getTime() - new Date(sesion.last_seen_at).getTime() > 30 * 1000) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(iso(ahora), iso(masMs(ahora, idleMs())), sesion.id);
  }

  return { sesionId: sesion.id, user: perfilPublico(user) };
}

function logout(token) {
  const valida = validarSesion(token);
  if (!valida) return { ok: true };
  revocar(valida.sesionId, 'logout');
  registrarEvento('logout', { username: valida.user.username, userId: valida.user.id });
  return { ok: true };
}

function revocarSesionesDeUsuario(userId, motivo, { exceptoSesionId = null } = {}) {
  db.prepare(
    'UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?'
  ).run(iso(reloj()), motivo, userId, exceptoSesionId);
}

function validarNuevaPassword(nueva) {
  if (typeof nueva !== 'string' || nueva.length < 6) return 'La contraseña debe tener al menos 6 caracteres';
  if (nueva.length > 72) return 'La contraseña no puede tener más de 72 caracteres';
  return null;
}

// El usuario cambia su propia contrasena. Cierra sus otras sesiones y quita
// la marca resetPass (cambio obligatorio tras un restablecimiento).
function cambiarPassword(token, actual, nueva) {
  const sesion = validarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión no válida' };

  const user = db.prepare('SELECT id, password FROM users WHERE id = ?').get(sesion.user.id);
  if (typeof actual !== 'string' || !bcrypt.compareSync(actual, user.password)) {
    return { ok: false, error: 'La contraseña actual no es correcta' };
  }
  const error = validarNuevaPassword(nueva);
  if (error) return { ok: false, error };
  if (bcrypt.compareSync(nueva, user.password)) {
    return { ok: false, error: 'La nueva contraseña debe ser distinta de la actual' };
  }

  db.transaction(() => {
    db.prepare(`UPDATE users SET password = ?, resetPass = 0, updated_at = ? WHERE id = ?`)
      .run(bcrypt.hashSync(nueva, config.auth.bcryptRounds), iso(reloj()), user.id);
    revocarSesionesDeUsuario(user.id, 'cambio_password', { exceptoSesionId: sesion.sesionId });
  })();
  return { ok: true };
}

// El administrador asigna una contrasena temporal: el usuario queda obligado
// a cambiarla al entrar (resetPass = 1, igual que en el sistema web) y se
// quita cualquier bloqueo por intentos fallidos.
function restablecerPassword(userId, temporal) {
  const error = validarNuevaPassword(temporal);
  if (error) return { ok: false, error };
  const info = db.transaction(() => {
    const r = db.prepare(
      `UPDATE users SET password = ?, resetPass = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`
    ).run(bcrypt.hashSync(temporal, config.auth.bcryptRounds), iso(reloj()), userId);
    revocarSesionesDeUsuario(userId, 'password_restablecida');
    return r;
  })();
  if (info.changes === 0) return { ok: false, error: 'Usuario no encontrado' };
  return { ok: true };
}

module.exports = {
  login,
  logout,
  validarSesion,
  revocarSesionesDeUsuario,
  cambiarPassword,
  restablecerPassword,
  perfilPublico,
  SELECT_USUARIO,
  TIPO_ADMIN,
  _setReloj,
};
