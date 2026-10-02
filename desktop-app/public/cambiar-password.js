const errorEl = document.getElementById('error');

function mostrarError(texto) {
  errorEl.textContent = texto;
  errorEl.classList.add('visible');
}

document.getElementById('cambioForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.remove('visible');
  const actual = document.getElementById('actual').value;
  const nueva = document.getElementById('nueva').value;
  if (nueva !== document.getElementById('nueva2').value) return mostrarError('Las contraseñas nuevas no coinciden');

  const btn = document.getElementById('btnCambiar');
  btn.disabled = true;
  const res = await api('/api/auth/cambiar-password', { method: 'POST', body: { actual, nueva } });
  btn.disabled = false;
  if (!res.ok) return mostrarError(res.error);
  window.location.replace('index.html');
});

document.getElementById('salir').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/auth/logout', { method: 'POST' });
  Sesion.limpiar();
  window.location.replace('login.html');
});

(async function iniciar() {
  if (!Sesion.token()) return window.location.replace('login.html');
  const me = await api('/api/auth/me');
  if (!me.ok) return window.location.replace('login.html');
  if (!me.user.resetPass) return window.location.replace('index.html');
  document.getElementById('saludo').textContent = `Hola, ${me.user.nombre}`;
})();
