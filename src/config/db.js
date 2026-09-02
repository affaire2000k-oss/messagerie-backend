const { Pool } = require('pg');
require('dotenv').config();

// Pool de connexions PostgreSQL.
// IMPORTANT : toutes les requêtes du projet utilisent des requêtes
// paramétrées ($1, $2...) — jamais de concaténation de chaînes —
// pour éliminer tout risque d'injection SQL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase utilise une chaîne de certificats qui échoue avec
  // rejectUnauthorized: true depuis certains environnements Node ;
  // on garde le chiffrement TLS mais sans vérification stricte du certificat.
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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
