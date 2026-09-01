const { Pool } = require('pg');
require('dotenv').config();

// Pool de connexions PostgreSQL.
// IMPORTANT : toutes les requêtes du projet utilisent des requêtes
// paramétrées ($1, $2...) — jamais de concaténation de chaînes —
// pour éliminer tout risque d'injection SQL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  max: 20,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Erreur inattendue sur le pool PostgreSQL', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
