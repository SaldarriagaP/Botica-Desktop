document.getElementById('btnLogin').addEventListener('click', login);
document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});

async function login() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('error');
  errorEl.textContent = '';

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();

  if (!data.ok) {
    errorEl.textContent = data.error;
    return;
  }

  localStorage.setItem('usuario', JSON.stringify(data.user));
  window.location.href = 'index.html';
}
