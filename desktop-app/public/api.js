// Cliente de la API local compartido por login.html e index.html.
// El token vive en sessionStorage: se borra al cerrar la app, asi que al
// volver a abrirla siempre se pide login.
//
// Indicador de carga: si una peticion demora mas de RETARDO_CARGA_MS se
// muestra la rueda girando con un texto ("Cargando...", "Registrando
// venta...", etc.). Las consultas de fondo usan { silencioso: true }.
// Toda peticion tiene tiempo limite: la ventana nunca queda colgada.

const RETARDO_CARGA_MS = 300;
const TIEMPO_LIMITE_MS = 30000;

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

// ---------- Indicador global de carga ----------
const cargas = new Map(); // id -> texto
let siguienteCarga = 0;

function pintarCarga() {
  const capa = document.getElementById('cargaGlobal');
  if (!capa) return;
  const textos = [...cargas.values()];
  capa.hidden = textos.length === 0;
  if (textos.length) document.getElementById('cargaTexto').textContent = textos[textos.length - 1];
}

// Muestra la rueda tras un breve retardo (si la operacion es instantanea no
// parpadea nada). Devuelve la funcion que la oculta.
function iniciarCarga(texto = 'Cargando...', retardo = RETARDO_CARGA_MS) {
  const id = ++siguienteCarga;
  const t = setTimeout(() => { cargas.set(id, texto); pintarCarga(); }, retardo);
  return () => { clearTimeout(t); cargas.delete(id); pintarCarga(); };
}

async function api(url, { method = 'GET', body, silencioso = false, cargando, tiempoLimite = TIEMPO_LIMITE_MS } = {}) {
  const headers = {};
  const token = Sesion.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const terminar = silencioso ? () => {} : iniciarCarga(cargando || (method === 'GET' ? 'Cargando...' : 'Procesando...'));
  const control = new AbortController();
  const limite = setTimeout(() => control.abort(), tiempoLimite);

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: control.signal });
  } catch (err) {
    terminar();
    clearTimeout(limite);
    return {
      ok: false,
      error: err && err.name === 'AbortError'
        ? 'El servidor local tardó demasiado en responder. Intenta nuevamente.'
        : 'No se pudo conectar con el servidor local de la aplicación',
    };
  }

  // Sesion vencida/revocada: volver al login (excepto en el propio login).
  if (res.status === 401 && url !== '/api/auth/login') {
    terminar();
    clearTimeout(limite);
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
  } finally {
    terminar();
    clearTimeout(limite);
  }
}

function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { Sesion, api, escapeHtml, iniciarCarga };
