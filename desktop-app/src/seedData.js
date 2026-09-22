const bcrypt = require('bcryptjs');

const users = [
  { id: 1, username: 'ADMIN01', password: 'admin123', nombre: 'Rosa Administradora', rol: 'admin' },
  { id: 2, username: 'VEND01', password: 'vendedor123', nombre: 'Luis Vendedor', rol: 'vendedor' },
];

const customers = [
  { nombre: 'Cliente Varios', documento: '00000000', telefono: '' },
  { nombre: 'Maria Gonzales Rojas', documento: '45678912', telefono: '999111222' },
];

const products = [
  { id: 101, nombre: 'Paracetamol 500mg', precio: 0.35, stock: 200, codigo_barras: '7750000000101' },
  { id: 102, nombre: 'Amoxicilina 500mg', precio: 1.8, stock: 60, codigo_barras: '7750000000102' },
  { id: 103, nombre: 'Ibuprofeno 400mg', precio: 0.4, stock: 150, codigo_barras: '7750000000103' },
  { id: 104, nombre: 'Loratadina 10mg', precio: 0.6, stock: 40, codigo_barras: '7750000000104' },
  { id: 105, nombre: 'Suero fisiologico 500ml', precio: 6.5, stock: 30, codigo_barras: '7750000000105' },
];

function seed(db) {
  db.get('SELECT COUNT(*) AS n FROM users', [], (err, row) => {
    if (err || (row && row.n > 0)) {
      return; // Ya existen usuarios cargados
    }

    db.serialize(() => {
      // Inserción de Usuarios
      const stmtUser = db.prepare('INSERT INTO users (id, username, password_hash, nombre, rol) VALUES (?,?,?,?,?)');
      for (const u of users) {
        stmtUser.run(u.id, u.username, bcrypt.hashSync(u.password, 10), u.nombre, u.rol);
      }
      stmtUser.finalize();

      // Inserción de Clientes
      const stmtCust = db.prepare('INSERT INTO customers (nombre, documento, telefono) VALUES (?,?,?)');
      for (const c of customers) {
        stmtCust.run(c.nombre, c.documento, c.telefono);
      }
      stmtCust.finalize();

      // Inserción de Productos
      const stmtProd = db.prepare('INSERT INTO products (id, nombre, precio, stock, codigo_barras) VALUES (?,?,?,?,?)');
      for (const p of products) {
        stmtProd.run(p.id, p.nombre, p.precio, p.stock, p.codigo_barras);
      }
      stmtProd.finalize();

      console.log('>>> Base de datos poblada exitosamente con datos de prueba.');
    });
  });
}

module.exports = { seed };