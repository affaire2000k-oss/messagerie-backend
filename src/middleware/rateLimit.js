const rateLimit = require('express-rate-limit');

// Limite stricte sur la connexion pour empêcher le brute-force de mots de passe.
const limiteurConnexion = rateLimit({
  windowMs: (Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives de connexion, réessayez plus tard' },
  skipSuccessfulRequests: true,
});

// Limite plus large pour l'API générale.
const limiteurGlobal = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de requêtes, ralentissez' },
});

module.exports = { limiteurConnexion, limiteurGlobal };
