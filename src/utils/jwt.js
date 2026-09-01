const jwt = require('jsonwebtoken');

/**
 * Stratégie access/refresh token :
 * - access token : courte durée (15 min), transporté en Authorization header
 * - refresh token : longue durée (7 jours), stocké en cookie httpOnly
 *   (inaccessible en JavaScript côté client -> protège contre le vol via XSS)
 */

function genererAccessToken(utilisateur) {
  return jwt.sign(
    {
      sub: utilisateur.id,
      email: utilisateur.email,
      poste: utilisateur.poste,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
  );
}

function genererRefreshToken(utilisateur) {
  return jwt.sign(
    { sub: utilisateur.id, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' }
  );
}

function verifierAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

function verifierRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

module.exports = {
  genererAccessToken,
  genererRefreshToken,
  verifierAccessToken,
  verifierRefreshToken,
};
