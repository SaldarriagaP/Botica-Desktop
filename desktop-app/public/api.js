// Cliente de la API local compartido por login.html e index.html.
// El token vive en sessionStorage: se borra al cerrar la app, asi que al
// volver a abrirla siempre se pide login.

const Sesion = {
  token() {
    try { return sessionStorage.getItem('botica.token'); } catch { return null; }
  },
  usuario() {
    try { return JSON.parse(sessionStorage.getItem('botica.usuario') || 'null'); } catch { return null; }
  },
  guardar(token, usuario) {
    sessionStorage.setItem('botica.token', token);
    sessionStorage.setItem('botica.usuario', JSON.stringify(usuario));
  },
  limpiar() {
    sessionStorage.removeItem('botica.token');
    sessionStorage.removeItem('botica.usuario');
  },
};

async function api(url, { method = 'GET', body } = {}) {
  const headers = {};
  const token = Sesion.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor local de la aplicación' };
  }

  // Sesion vencida/revocada: volver al login (excepto en el propio login).
  if (res.status === 401 && url !== '/api/auth/login') {
    Sesion.limpiar();
    window.location.replace('login.html?motivo=expirada');
    return new Promise(() => {});
  }

  try {
    const data = await res.json();
    // Contrasena restablecida por el admin: primero debe cambiarla.
    if (res.status === 403 && data.code === 'CAMBIO_PASSWORD' && !window.location.pathname.endsWith('cambiar-password.html')) {
      window.location.replace('cambiar-password.html');
      return new Promise(() => {});
    }
    return data;
  } catch {
    return { ok: false, error: `Respuesta inesperada del servidor local (${res.status})` };
  }
}

function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
