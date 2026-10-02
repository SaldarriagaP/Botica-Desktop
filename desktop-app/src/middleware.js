// Middlewares de autenticacion/autorizacion para la API local.
// La identidad sale SIEMPRE del token de sesion validado en la BD, nunca de
// datos que mande el cliente en el body (ej. "actorUsername").

const auth = require('./auth');
const permisos = require('./permisos');

// Con resetPass = 1 el usuario solo puede cambiar su contrasena o salir.
const RUTAS_CON_RESET_PASS = new Set(['/auth/me', '/auth/logout', '/auth/cambiar-password']);

function requireAuth(req, res, next) {
  const m = /^Bearer ([0-9a-f]{64})$/i.exec(req.get('authorization') || '');
  const sesion = m ? auth.validarSesion(m[1].toLowerCase()) : null;
  if (!sesion) {
    return res.status(401).json({ ok: false, code: 'NO_AUTH', error: 'Tu sesión expiró o no es válida. Vuelve a iniciar sesión.' });
  }
  if (sesion.user.resetPass && !RUTAS_CON_RESET_PASS.has(req.path)) {
    return res.status(403).json({ ok: false, code: 'CAMBIO_PASSWORD', error: 'Debes cambiar tu contraseña antes de continuar.' });
  }
  req.user = sesion.user;
  req.token = m[1].toLowerCase();
  next();
}

function requirePermiso(permiso) {
  permisos.tiene(1, permiso); // falla al arrancar si el permiso no existe
  return (req, res, next) => {
    if (!req.user || !permisos.tiene(req.user.type, permiso)) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'No tienes permiso para realizar esta acción' });
    }
    next();
  };
}

module.exports = { requireAuth, requirePermiso };
