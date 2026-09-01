const db = require('../config/db');

/**
 * Vérifie que l'utilisateur authentifié est bien membre de la
 * conversation qu'il tente de consulter/écrire. Empêche l'accès
 * horizontal (un employé qui devine l'UUID d'une conversation
 * d'autres personnes ne peut pas y accéder).
 */
async function verifierMembreConversation(req, res, next) {
  const { conversationId } = req.params;
  const utilisateurId = req.utilisateur.id;

  try {
    const result = await db.query(
      `SELECT 1 FROM conversation_membres
       WHERE conversation_id = $1 AND utilisateur_id = $2`,
      [conversationId, utilisateurId]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({ erreur: 'Accès refusé à cette conversation' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Vérifie que l'utilisateur authentifié est bien le destinataire
 * (supérieur direct) de la demande qu'il tente de valider/refuser.
 * Empêche qu'un tiers ou l'auteur lui-même valide sa propre demande.
 */
async function verifierDestinataireDemande(req, res, next) {
  const { demandeId } = req.params;
  const utilisateurId = req.utilisateur.id;

  try {
    const result = await db.query(
      `SELECT destinataire_id, statut FROM demandes WHERE id = $1`,
      [demandeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erreur: 'Demande introuvable' });
    }

    const demande = result.rows[0];

    if (demande.destinataire_id !== utilisateurId) {
      return res.status(403).json({ erreur: "Vous n'êtes pas autorisé à traiter cette demande" });
    }

    if (demande.statut !== 'en_attente') {
      return res.status(409).json({ erreur: 'Cette demande a déjà été traitée' });
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Vérifie que l'utilisateur est admin du groupe pour les actions
 * sensibles (ajouter/retirer un membre, renommer le groupe).
 */
async function verifierAdminGroupe(req, res, next) {
  const { conversationId } = req.params;
  const utilisateurId = req.utilisateur.id;

  try {
    const result = await db.query(
      `SELECT role FROM conversation_membres
       WHERE conversation_id = $1 AND utilisateur_id = $2`,
      [conversationId, utilisateurId]
    );

    if (result.rowCount === 0 || result.rows[0].role !== 'admin') {
      return res.status(403).json({ erreur: 'Action réservée aux administrateurs du groupe' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  verifierMembreConversation,
  verifierDestinataireDemande,
  verifierAdminGroupe,
};
