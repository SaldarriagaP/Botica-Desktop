const path = require('path');
const express = require('express');

let db;
try {
  console.log('>>> Cargando base de datos...');
  db = require('./src/db').db;
  
  console.log('>>> Cargando datos iniciales (seed)...');
  const { seed } = require('./src/seedData');
  seed(db);
  console.log('>>> Base de datos lista.');
} catch (err) {
  console.error('>>> CRASH EN BASE DE DATOS / SEED:', err);
}

const routes = require('./src/routes');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', routes);

const PORT = process.env.PORT || 4500;
app.listen(PORT, () => console.log(`Desktop Botica escuchando en http://localhost:${PORT}`));