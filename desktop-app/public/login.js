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
  togglePassword.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
  togglePassword.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
  eyeIcon.innerHTML = mostrar
    ? '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/><path d="M4 4l16 16"/>'
    : '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/>';
});

async function login() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('error');
  errorEl.textContent = '';
  errorEl.classList.remove('visible');

  const btn = document.getElementById('btnLogin');
  btn.disabled = true;

  let data;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    data = await res.json();
  } catch (err) {
    btn.disabled = false;
    errorEl.textContent = 'No se pudo conectar con el servidor local';
    errorEl.classList.add('visible');
    return;
  }

  if (!data.ok) {
    btn.disabled = false;
    errorEl.textContent = data.error;
    errorEl.classList.add('visible');
    return;
  }

  localStorage.setItem('usuario', JSON.stringify(data.user));
  window.location.href = 'index.html';
}
