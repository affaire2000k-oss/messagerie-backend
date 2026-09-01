const { verifierAccessToken } = require('../utils/jwt');
const db = require('../config/db');
const logger = require('../config/logger');

/**
 * Initialise Socket.io avec une authentification obligatoire par
 * JWT (le socket est rejeté sans token valide -> aucune connexion
 * anonyme possible) puis rejoint automatiquement l'utilisateur à
 * ses propres rooms (une par conversation dont il est membre, plus
 * sa room personnelle pour les notifications).
 */
function initialiserSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentification requise'));
    }
    try {
      const payload = verifierAccessToken(token);
      socket.utilisateurId = payload.sub;
      next();
    } catch (err) {
      next(new Error('Token invalide ou expiré'));
    }
  });

  io.on('connection', async (socket) => {
    const utilisateurId = socket.utilisateurId;
    logger.info('Socket connecté', { utilisateurId });

    // Room personnelle pour les notifications ciblées
    socket.join(`utilisateur:${utilisateurId}`);

    // Rejoint uniquement les conversations dont l'utilisateur est
    // réellement membre en base — jamais une room fournie par le client.
    try {
      const result = await db.query(
        'SELECT conversation_id FROM conversation_membres WHERE utilisateur_id = $1',
        [utilisateurId]
      );
      result.rows.forEach((row) => socket.join(`conversation:${row.conversation_id}`));
    } catch (err) {
      logger.error('Erreur en rejoignant les rooms de conversation', { err: err.message });
    }

    // Indicateur "en train d'écrire" — vérifie l'appartenance avant de diffuser
    socket.on('en_train_ecrire', async ({ conversation_id }) => {
      const appartient = await db.query(
        'SELECT 1 FROM conversation_membres WHERE conversation_id = $1 AND utilisateur_id = $2',
        [conversation_id, utilisateurId]
      );
      if (appartient.rowCount > 0) {
        socket.to(`conversation:${conversation_id}`).emit('en_train_ecrire', { utilisateur_id: utilisateurId });
      }
    });

    socket.on('disconnect', () => {
      logger.info('Socket déconnecté', { utilisateurId });
    });
  });
}

module.exports = { initialiserSocket };
