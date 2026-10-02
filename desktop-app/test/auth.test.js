// Pruebas unitarias del modulo de autenticacion (Iteracion XP 1).

const { usarBaseTemporal } = require('./helpers');
usarBaseTemporal('auth');

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');
const { seed } = require('../src/seedData');
const config = require('../src/config');
const auth = require('../src/auth');
const usuarios = require('../src/usuarios');

seed(db);

// Reloj controlado por la prueba.
let ahora = new Date('2026-10-05T13:00:00.000Z');
auth._setReloj(() => ahora);
const avanzar = (ms) => { ahora = new Date(ahora.getTime() + ms); };
const MIN = 60 * 1000;

const ultimoEvento = () => db.prepare('SELECT * FROM auth_log ORDER BY id DESC LIMIT 1').get();

test.describe('login', () => {
  test('ADMIN01 entra como administrador', () => {
    const r = auth.login('ADMIN01', 'admin123');
    assert.equal(r.ok, true);
    assert.match(r.token, /^[0-9a-f]{64}$/);
    assert.equal(r.user.type, 1);
    assert.equal(r.user.rol, 'administrador');
    assert.equal(r.user.esAdmin, true);
    assert.equal(r.user.nombre, 'Rosa Administradora');
    assert.equal(r.user.local, config.localId);
    assert.equal(r.user.localNombre, 'PRUEBAS - SISTEMA');
    assert.equal(r.user.password, undefined, 'nunca se expone el hash');
    assert.equal(ultimoEvento().event, 'login_ok');
  });

  test('VEND01 entra como vendedor (sin permisos de admin)', () => {
    const r = auth.login('VEND01', 'vendedor123');
    assert.equal(r.ok, true);
    assert.equal(r.user.type, 2);
    assert.equal(r.user.rol, 'vendedor');
    assert.equal(r.user.esAdmin, false);
  });

  test('el usuario no distingue mayusculas y tolera espacios', () => {
    assert.equal(auth.login('  vend01 ', 'vendedor123').ok, true);
  });

  test('la contrasena si distingue mayusculas', () => {
    assert.equal(auth.login('VEND01', 'VENDEDOR123').ok, false);
    auth.login('VEND01', 'vendedor123'); // limpia el contador
  });

  test('contrasena incorrecta y usuario inexistente dan el mismo mensaje', () => {
    const malaClave = auth.login('ADMIN01', 'otra');
    const noExiste = auth.login('NOEXISTE', 'otra');
    assert.equal(malaClave.ok, false);
    assert.equal(malaClave.error, noExiste.error);
    assert.equal(malaClave.token, undefined);
    assert.equal(ultimoEvento().event, 'login_fallido');
    auth.login('ADMIN01', 'admin123');
  });

  test('campos vacios o de tipo invalido', () => {
    assert.equal(auth.login('', 'x').ok, false);
    assert.equal(auth.login('ADMIN01', '').ok, false);
    assert.equal(auth.login(undefined, undefined).ok, false);
    assert.equal(auth.login({ $ne: 1 }, ['admin123']).ok, false);
  });

  test('acepta hashes $2y$ generados por Laravel (mismas claves que el sistema web)', () => {
    const hashLaravel = '$2y$' + bcrypt.hashSync('claveWeb1', 10).slice(4);
    db.prepare(
      "INSERT INTO users (dni, type, username, firstname, lastname, local, password) VALUES ('44556677', 2, 'SMOSCOLL2', 'Silvia', 'Moscol', 8, ?)"
    ).run(hashLaravel);
    const r = auth.login('SMOSCOLL2', 'claveWeb1');
    assert.equal(r.ok, true);
    assert.equal(r.user.localNombre, 'Solidaria Grau');
  });
});

test.describe('sesiones', () => {
  test('en la BD solo se guarda el hash del token', () => {
    const { token } = auth.login('VEND01', 'vendedor123');
    const enClaro = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token).n;
    assert.equal(enClaro, 0);
  });

  test('una sesion valida devuelve al usuario leido de la BD', () => {
    const { token } = auth.login('VEND01', 'vendedor123');
    const s = auth.validarSesion(token);
    assert.equal(s.user.username, 'VEND01');
    assert.equal(s.user.type, 2);
  });

  test('tokens basura o inexistentes no son validos', () => {
    assert.equal(auth.validarSesion('abc'), null);
    assert.equal(auth.validarSesion('f'.repeat(64)), null);
    assert.equal(auth.validarSesion(null), null);
  });

  test('logout invalida el token y es idempotente', () => {
    const { token } = auth.login('VEND01', 'vendedor123');
    assert.deepEqual(auth.logout(token), { ok: true });
    assert.equal(auth.validarSesion(token), null);
    assert.equal(ultimoEvento().event, 'logout');
    assert.deepEqual(auth.logout(token), { ok: true });
  });

  test('expira por inactividad', () => {
    const { token } = auth.login('VEND01', 'vendedor123');
    avanzar((config.session.idleMinutes + 1) * MIN);
    assert.equal(auth.validarSesion(token), null);
    assert.equal(ultimoEvento().event, 'sesion_expirada');
  });

  test('el uso continuo la mantiene viva (expiracion deslizante)', () => {
    const { token } = auth.login('VEND01', 'vendedor123');
    const tramo = Math.floor(config.session.idleMinutes * 0.75) * MIN;
    avanzar(tramo);
    assert.ok(auth.validarSesion(token));
    avanzar(tramo);
    assert.ok(auth.validarSesion(token), 'sigue viva porque se uso a mitad de camino');
  });
});

test.describe('bloqueo por intentos fallidos', () => {
  test(`tras ${config.auth.maxAttempts} intentos fallidos se bloquea temporalmente`, () => {
    for (let i = 1; i < config.auth.maxAttempts; i++) {
      assert.equal(auth.login('VEND01', 'mala').bloqueadoSegundos, undefined);
    }
    const r = auth.login('VEND01', 'mala');
    assert.equal(r.ok, false);
    assert.equal(r.bloqueadoSegundos, config.auth.lockoutSeconds);

    // Ni la clave correcta entra mientras dure el bloqueo.
    const conClaveBuena = auth.login('VEND01', 'vendedor123');
    assert.equal(conClaveBuena.ok, false);
    assert.ok(conClaveBuena.bloqueadoSegundos > 0);
  });

  test('pasado el tiempo de bloqueo vuelve a entrar y el contador se reinicia', () => {
    avanzar((config.auth.lockoutSeconds + 1) * 1000);
    assert.equal(auth.login('VEND01', 'vendedor123').ok, true);
    assert.equal(db.prepare("SELECT failed_attempts FROM users WHERE username = 'VEND01'").get().failed_attempts, 0);
  });

  test('el bloqueo de un usuario no afecta a otro', () => {
    for (let i = 0; i < config.auth.maxAttempts; i++) auth.login('VEND01', 'mala');
    assert.equal(auth.login('ADMIN01', 'admin123').ok, true);
    avanzar((config.auth.lockoutSeconds + 1) * 1000);
  });
});

test.describe('usuarios inactivos y gestion', () => {
  const admin = () => auth.login('ADMIN01', 'admin123').user;

  test('desactivar a un usuario corta sus sesiones abiertas y ya no puede entrar', () => {
    const { token } = auth.login('VEND01', 'vendedor123');
    const vend = db.prepare("SELECT id FROM users WHERE username = 'VEND01'").get();

    assert.deepEqual(usuarios.cambiarEstado(vend.id, 0, admin()), { ok: true });
    assert.equal(auth.validarSesion(token), null);

    const r = auth.login('VEND01', 'vendedor123');
    assert.equal(r.ok, false);
    assert.match(r.error, /inactivo/);

    usuarios.cambiarEstado(vend.id, 1, admin());
    assert.equal(auth.login('VEND01', 'vendedor123').ok, true);
  });

  test('un admin no puede desactivarse a si mismo', () => {
    const a = admin();
    assert.equal(usuarios.cambiarEstado(a.id, 0, a).ok, false);
  });

  test('no se puede desactivar al ultimo administrador activo', () => {
    const creado = usuarios.crear({ username: 'ADMIN02', password: 'segura1', dni: '12345678', firstname: 'Ana', type: 1 });
    assert.equal(creado.ok, true);
    const ana = auth.login('ADMIN02', 'segura1').user;

    // Ana desactiva a ADMIN01 (queda Ana) y luego no puede quedarse sin admins.
    assert.equal(usuarios.cambiarEstado(1, 0, ana).ok, true);
    const r = usuarios.cambiarEstado(ana.id, 0, { id: -1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /al menos un administrador/);
    usuarios.cambiarEstado(1, 1, ana);
  });

  test('crear usuario valida los datos', () => {
    const base = { username: 'VEND02', password: 'clave12', dni: '87654321', firstname: 'Juan', type: 2 };
    assert.match(usuarios.crear({ ...base, dni: '123' }).error, /DNI/);
    assert.match(usuarios.crear({ ...base, password: '123' }).error, /6 caracteres/);
    assert.match(usuarios.crear({ ...base, type: 99 }).error, /Rol/);
    assert.match(usuarios.crear({ ...base, local: 999 }).error, /Sucursal/);
    assert.match(usuarios.crear({ ...base, username: 'a b' }).error, /usuario/);
    assert.match(usuarios.crear({ ...base, email: 'no-es-email' }).error, /email/);

    assert.equal(usuarios.crear(base).ok, true);
    assert.match(usuarios.crear({ ...base, username: 'vend02' }).error, /Ya existe/);
    const r = auth.login('VEND02', 'clave12');
    assert.equal(r.ok, true);
    assert.equal(r.user.local, config.localId, 'por defecto se asigna la sucursal de la terminal');
  });

  test('listar usuarios nunca expone contrasenas', () => {
    for (const u of usuarios.listar()) {
      assert.equal(u.password, undefined);
    }
  });
});
