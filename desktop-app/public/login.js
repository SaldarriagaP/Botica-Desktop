import { Sesion, api } from './api.js';

const errorEl = document.getElementById('error');
const btn = document.getElementById('btnLogin');

function mostrarAviso(texto, tipo = 'error') {
  errorEl.textContent = texto;
  errorEl.classList.toggle('info', tipo === 'info');
  errorEl.classList.add('visible');
}

function ocultarAviso() {
  errorEl.textContent = '';
  errorEl.classList.remove('visible', 'info');
}

document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  login();
});

const togglePassword = document.getElementById('toggle-password');
const passwordInput = document.getElementById('password');
const eyeIcon = document.getElementById('eyeIcon');

togglePassword.addEventListener('click', () => {
  const mostrar = passwordInput.type === 'password';
  passwordInput.type = mostrar ? 'text' : 'password';
  togglePassword.setAttribute('aria-label', mostrar ? 'Ocultar clave' : 'Mostrar clave');
  togglePassword.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
  eyeIcon.className = mostrar ? 'fa fa-eye-slash' : 'fa fa-eye';
});

// Mientras valida, el boton muestra la rueda girando (como el web).
function cargando(si) {
  btn.disabled = si;
  btn.classList.toggle('cargando', si);
  document.getElementById('btnLoginTexto').textContent = si ? 'Ingresando...' : 'Ingresar';
  document.getElementById('btnLoginIcono').className = si ? 'fa fa-spinner fa-spin' : 'fa fa-arrow-right';
}

async function login() {
  const username = document.getElementById('username').value.trim();
  const password = passwordInput.value;
  ocultarAviso();
  cargando(true);

  const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });

  if (!data.ok) {
    cargando(false);
    mostrarAviso(data.error || 'No se pudo iniciar sesión');
    passwordInput.value = '';
    passwordInput.focus();
    return;
  }

  Sesion.guardar(data.token, data.user);
  window.location.replace(data.user.resetPass ? 'cambiar-password.html' : 'index.html');
}

async function iniciar() {
  try { localStorage.removeItem('usuario'); } catch { /* resto de la version anterior */ }
  const motivo = new URLSearchParams(window.location.search).get('motivo');
  if (motivo === 'expirada') mostrarAviso('Tu sesión expiró. Vuelve a iniciar sesión.', 'info');
  if (motivo === 'logout') mostrarAviso('Cerraste sesión correctamente.', 'info');

  // Si ya hay una sesion valida en esta ventana, entrar directo.
  if (Sesion.token()) {
    const me = await api('/api/auth/me');
    if (me.ok) return window.location.replace('index.html');
  }

  const terminal = await api('/api/terminal');
  if (terminal && terminal.local) {
    document.getElementById('terminalLocal').textContent = `Sucursal: ${terminal.local.name}`;
  }
}

iniciar();
