const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const logger = require('../config/logger');
const {
  genererAccessToken,
  genererRefreshToken,
  verifierRefreshToken,
} = require('../utils/jwt');

const SALT_ROUNDS = 12;

const cookieRefreshOptions = {
  httpOnly: true, // inaccessible en JS -> protège contre le vol via XSS
  secure: process.env.NODE_ENV === 'production', // HTTPS uniquement en prod
  sameSite: 'strict', // protège contre le CSRF
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/auth',
};

// ---------- Validateurs ----------
const validationConnexion = [
  body('email').isEmail().normalizeEmail(),
  body('mot_de_passe').isLength({ min: 8 }),
];

const validationInscription = [
  body('nom_complet').trim().isLength({ min: 2, max: 150 }).escape(),
  body('email').isEmail().normalizeEmail(),
  body('mot_de_passe')
    .isLength({ min: 8 })
    .withMessage('Le mot de passe doit contenir au moins 8 caractères')
    .matches(/[A-Z]/).withMessage('Le mot de passe doit contenir une majuscule')
    .matches(/[0-9]/).withMessage('Le mot de passe doit contenir un chiffre'),
  body('poste').optional().trim().isLength({ max: 100 }).escape(),
  body('superieur_id').optional().isUUID(),
];

// ---------- Inscription ----------
// Note : en pratique, seul un admin RH devrait pouvoir créer des comptes.
// Cet endpoint peut être restreint (verrouillé derrière un middleware admin)
// selon vos besoins de déploiement — laissé ouvert ici pour la démo.
async function inscrire(req, res, next) {
  const erreurs = validationResult(req);
  if (!erreurs.isEmpty()) {
    return res.status(400).json({ erreurs: erreurs.array() });
  }

  const { nom_complet, email, mot_de_passe, poste, superieur_id } = req.body;

  try {
    const existant = await db.query('SELECT 1 FROM utilisateurs WHERE email = $1', [email]);
    if (existant.rowCount > 0) {
      // Message volontairement générique pour ne pas confirmer l'existence d'un compte
      return res.status(400).json({ erreur: 'Impossible de créer ce compte' });
    }

    const hash = await bcrypt.hash(mot_de_passe, SALT_ROUNDS);

    const result = await db.query(
      `INSERT INTO utilisateurs (nom_complet, email, mot_de_passe_hash, poste, superieur_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nom_complet, email, poste, superieur_id`,
      [nom_complet, email, hash, poste || null, superieur_id || null]
    );

    logger.info('Nouvel utilisateur créé', { userId: result.rows[0].id });
    return res.status(201).json({ utilisateur: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

// ---------- Connexion ----------
async function connecter(req, res, next) {
  const erreurs = validationResult(req);
  if (!erreurs.isEmpty()) {
    return res.status(400).json({ erreurs: erreurs.array() });
  }

  const { email, mot_de_passe } = req.body;

  try {
    const result = await db.query(
      `SELECT id, nom_complet, email, mot_de_passe_hash, poste, actif
       FROM utilisateurs WHERE email = $1`,
      [email]
    );

    // Message d'erreur identique que l'email existe ou non, et qu'il
    // s'agisse d'un mauvais mot de passe ou d'un email inconnu.
    // Cela empêche un attaquant de deviner quels emails sont enregistrés.
    const messageErreurGenerique = { erreur: 'Identifiants incorrects' };

    if (result.rowCount === 0) {
      return res.status(401).json(messageErreurGenerique);
    }

    const utilisateur = result.rows[0];

    if (!utilisateur.actif) {
      return res.status(403).json({ erreur: 'Compte désactivé, contactez votre administrateur' });
    }

    const motDePasseValide = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe_hash);
    if (!motDePasseValide) {
      logger.warn('Tentative de connexion échouée', { email });
      return res.status(401).json(messageErreurGenerique);
    }

    const accessToken = genererAccessToken(utilisateur);
    const refreshToken = genererRefreshToken(utilisateur);

    // Le cookie httpOnly sert le client web (navigateur) : le
    // refresh token n'est jamais exposé au JS du navigateur.
    res.cookie('refresh_token', refreshToken, cookieRefreshOptions);

    logger.info('Connexion réussie', { userId: utilisateur.id });

    return res.json({
      access_token: accessToken,
      // Sur mobile natif (React Native), il n'existe pas de cookie
      // httpOnly automatique comme dans un navigateur : on renvoie
      // donc aussi le refresh token dans le corps de la réponse,
      // pour qu'il soit stocké côté app dans le Keychain/Keystore
      // chiffré (voir mobile-app/src/services/secureStorage.js).
      // Le client web, lui, peut simplement ignorer ce champ et
      // continuer à utiliser le cookie httpOnly.
      refresh_token: refreshToken,
      utilisateur: {
        id: utilisateur.id,
        nom_complet: utilisateur.nom_complet,
        email: utilisateur.email,
        poste: utilisateur.poste,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ---------- Rafraîchissement du token ----------
// Accepte le refresh token soit via le cookie httpOnly (client web),
// soit via le corps de la requête (client mobile natif, qui l'a
// stocké lui-même en Keychain/Keystore lors de la connexion).
async function rafraichir(req, res) {
  const token = req.cookies?.refresh_token || req.body?.refresh_token;

  if (!token) {
    return res.status(401).json({ erreur: 'Session expirée, reconnectez-vous' });
  }

  try {
    const payload = verifierRefreshToken(token);
    const result = await db.query(
      'SELECT id, email, poste, actif FROM utilisateurs WHERE id = $1',
      [payload.sub]
    );

    if (result.rowCount === 0 || !result.rows[0].actif) {
      return res.status(401).json({ erreur: 'Session invalide' });
    }

    const nouvelAccessToken = genererAccessToken(result.rows[0]);
    return res.json({ access_token: nouvelAccessToken });
  } catch (err) {
    return res.status(401).json({ erreur: 'Session expirée, reconnectez-vous' });
  }
}

// ---------- Déconnexion ----------
function deconnecter(req, res) {
  res.clearCookie('refresh_token', { path: '/api/auth' });
  return res.status(204).send();
}

module.exports = {
  inscrire,
  connecter,
  rafraichir,
  deconnecter,
  validationConnexion,
  validationInscription,
};
