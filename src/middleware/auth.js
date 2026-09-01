const { verifierAccessToken } = require('../utils/jwt');

/**
 * Vérifie la présence et la validité du token d'accès sur les
 * routes protégées. Rejette systématiquement toute requête sans
 * token valide (fail closed, jamais fail open).
 */
function authentifier(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ erreur: 'Authentification requise' });
  }

  const token = header.split(' ')[1];

  try {
    const payload = verifierAccessToken(token);
    req.utilisateur = { id: payload.sub, email: payload.email, poste: payload.poste };
    next();
  } catch (err) {
    return res.status(401).json({ erreur: 'Session invalide ou expirée' });
  }
}

module.exports = { authentifier };
