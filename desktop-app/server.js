const path = require('path');
const express = require('express');
const { db } = require('./src/db');
const { seed } = require('./src/seedData');
const routes = require('./src/routes');

seed(db);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', routes);

const PORT = process.env.PORT || 4500;
app.listen(PORT, () => console.log(`Desktop Botica (simple) escuchando en http://localhost:${PORT}`));
