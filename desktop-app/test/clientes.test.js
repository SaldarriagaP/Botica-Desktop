// Pruebas del modulo de clientes.

const { usarBaseTemporal } = require('./helpers');
usarBaseTemporal('clientes');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/db');
const { seed } = require('../src/seedData');
const clientes = require('../src/clientes');

seed(db);
const actor = { id: 2 };

test.describe('validacion de documentos (reglas SUNAT)', () => {
  test('RUC con digito verificador', () => {
    assert.equal(clientes.rucValido('20607015083'), true); // T&J E.I.R.L.
    assert.equal(clientes.rucValido('20607015084'), false, 'digito verificador incorrecto');
    assert.equal(clientes.rucValido('30607015083'), false, 'prefijo invalido');
    assert.equal(clientes.rucValido('2060701508'), false, 'longitud');
  });

  test('DNI, CE, pasaporte y sin documento', () => {
    assert.equal(clientes.validarDocumento('1', '41234567'), null);
    assert.match(clientes.validarDocumento('1', '4123456'), /8 dígitos/);
    assert.match(clientes.validarDocumento('1', '4123456A'), /8 dígitos/);
    assert.equal(clientes.validarDocumento('4', '001234567'), null);
    assert.equal(clientes.validarDocumento('7', 'AB123456'), null);
    assert.equal(clientes.validarDocumento('0', ''), null);
    assert.match(clientes.validarDocumento('0', '123'), /sin documento/);
    assert.match(clientes.validarDocumento('9', '123'), /inválido/);
  });

  test('tipo de cliente segun documento (como el web)', () => {
    assert.equal(clientes.tipoCliente('6', '20607015083'), 2, 'RUC 20 = empresa');
    assert.equal(clientes.tipoCliente('6', '10412345671'), 1, 'RUC 10 = persona con negocio');
    assert.equal(clientes.tipoCliente('1', '41234567'), 1);
    assert.equal(clientes.tipoCliente('0', ''), 3);
  });
});

test.describe('alta y edicion', () => {
  test('crea un cliente con DNI y normaliza los datos', () => {
    const r = clientes.crear({ name: '  juan   perez  ruiz ', tipoDocumento: '1', code: '41234567', phone: '987654321', email: 'JUAN@MAIL.COM' }, actor);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.cliente.name, 'JUAN PEREZ RUIZ');
    assert.equal(r.cliente.tipo_documento_nombre, 'DNI');
    assert.equal(r.cliente.type_name, 'persona');
    assert.equal(r.cliente.email, 'juan@mail.com');
    assert.equal(r.cliente.sync_pendiente, 1, 'queda pendiente de subir al central');
    assert.equal(db.prepare('SELECT created_by FROM customers WHERE id = ?').get(r.id).created_by, 2);
  });

  test('empresa con RUC 20 queda como tipo empresa', () => {
    const r = clientes.crear({ name: 'Boticas del Norte S.A.C.', tipoDocumento: '6', code: '20100070970' }, actor);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.cliente.type_name, 'empresa');
  });

  test('no permite documentos duplicados e indica quien lo tiene', () => {
    const r = clientes.crear({ name: 'Otro', tipoDocumento: '1', code: '41234567' }, actor);
    assert.equal(r.ok, false);
    assert.match(r.error, /JUAN PEREZ RUIZ/);
    assert.ok(r.clienteId);
  });

  test('varios clientes sin documento pueden coexistir', () => {
    assert.equal(clientes.crear({ name: 'Señora de la esquina', tipoDocumento: '0', code: '' }, actor).ok, true);
    assert.equal(clientes.crear({ name: 'Señor del mercado', tipoDocumento: '0', code: '' }, actor).ok, true);
  });

  test('rechaza datos invalidos', () => {
    assert.match(clientes.crear({ name: '', tipoDocumento: '1', code: '12345678' }).error, /nombre/);
    assert.match(clientes.crear({ name: 'X Y', tipoDocumento: '6', code: '20607015084' }).error, /RUC no es válido/);
    assert.match(clientes.crear({ name: 'X Y', tipoDocumento: '1', code: '99887766', phone: '12' }).error, /teléfono/);
    assert.match(clientes.crear({ name: 'X Y', tipoDocumento: '1', code: '99887766', email: 'mal' }).error, /email/);
  });

  test('editar actualiza, revalida y vuelve a marcar pendiente de sincronizar', () => {
    const c = clientes.buscarPorDocumento('41234567');
    db.prepare('UPDATE customers SET sync_pendiente = 0 WHERE id = ?').run(c.id);
    const r = clientes.actualizar(c.id, { name: 'Juan Perez Ruiz', tipoDocumento: '1', code: '41234567', address: 'Av. Sánchez Cerro 123' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.cliente.address, 'Av. Sánchez Cerro 123');
    assert.equal(r.cliente.sync_pendiente, 1);
    assert.match(clientes.actualizar(c.id, { name: 'Otro Nombre', tipoDocumento: '6', code: '20100070970' }).error, /otro cliente/);
    assert.equal(clientes.actualizar(99999, { name: 'Nadie', tipoDocumento: '0' }).ok, false);
  });

  test('activar / desactivar', () => {
    const c = clientes.buscarPorDocumento('41234567');
    assert.equal(clientes.cambiarEstado(c.id, 0).ok, true);
    assert.equal(clientes.obtener(c.id).status, 0);
    assert.equal(clientes.listar({ q: '41234567', soloActivos: true }).total, 0);
    clientes.cambiarEstado(c.id, 1);
  });
});

test.describe('busqueda', () => {
  test('por documento exacto (uso en caja)', () => {
    assert.equal(clientes.buscarPorDocumento(' 20607015083 ').name, 'SOLUCIONES EN INGENIERIA T&J E.I.R.L.');
    assert.equal(clientes.buscarPorDocumento('00000001'), null);
  });

  test('por palabras del nombre en cualquier orden y por inicio de documento', () => {
    assert.equal(clientes.listar({ q: 'ruiz juan' }).items[0].code, '41234567');
    assert.equal(clientes.listar({ q: '4123' }).items[0].code, '41234567');
    assert.equal(clientes.listar({ q: 'zzzz' }).total, 0);
  });

  test('los comodines de SQL se buscan como texto', () => {
    assert.equal(clientes.listar({ q: '%' }).total, 0);
    assert.equal(clientes.listar({ q: '_' }).total, 0);
  });

  test('paginacion', () => {
    for (let i = 0; i < 30; i++) {
      clientes.crear({ name: `Cliente Paginado ${String(i).padStart(2, '0')}`, tipoDocumento: '1', code: String(70000000 + i) });
    }
    const p1 = clientes.listar({ q: 'paginado', porPagina: 10, pagina: 1 });
    const p3 = clientes.listar({ q: 'paginado', porPagina: 10, pagina: 3 });
    assert.equal(p1.total, 30);
    assert.equal(p1.paginas, 3);
    assert.equal(p1.items.length, 10);
    assert.equal(p3.items[9].name, 'CLIENTE PAGINADO 29');
    assert.equal(clientes.listar({ q: 'paginado', porPagina: 10, pagina: 99 }).pagina, 3, 'una pagina fuera de rango se ajusta');
    assert.equal(clientes.listar({ porPagina: 5000 }).porPagina, 100, 'maximo 100 por pagina');
  });
});
