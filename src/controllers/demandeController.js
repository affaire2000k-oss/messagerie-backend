const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const logger = require('../config/logger');

// ---------- Validateurs ----------
const validationCreationDemande = [
  body('type_code').isString().trim().notEmpty(),
  body('conversation_id').isUUID(),
  body('montant').optional().isFloat({ min: 0 }),
  body('devise_code').optional().isString().isLength({ min: 3, max: 3 }),
  body('champs_valeurs').isObject(),
];

const validationTraitementDemande = [
  param('demandeId').isUUID(),
  body('commentaire').optional().trim().isLength({ max: 1000 }).escape(),
];

/**
 * Crée une demande : détermine automatiquement le destinataire
 * (le supérieur direct de l'auteur, jamais un champ envoyé par le
 * client -> empêche un utilisateur de choisir lui-même son validateur),
 * l'insère, crée le message associé dans la conversation, et notifie
 * le destinataire.
 */
async function creerDemande(req, res, next) {
  const erreurs = validationResult(req);
  if (!erreurs.isEmpty()) {
    return res.status(400).json({ erreurs: erreurs.array() });
  }

  const auteurId = req.utilisateur.id;
  const { type_code, conversation_id, montant, devise_code, champs_valeurs } = req.body;

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Le destinataire est TOUJOURS déduit côté serveur à partir de la
    // hiérarchie réelle en base — jamais fourni par le client.
    const auteurResult = await client.query(
      'SELECT superieur_id FROM utilisateurs WHERE id = $1',
      [auteurId]
    );

    const superieurId = auteurResult.rows[0]?.superieur_id;
    if (!superieurId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erreur: "Aucun supérieur direct n'est configuré pour votre compte" });
    }

    const typeResult = await client.query(
      'SELECT id, champs_schema FROM types_demande WHERE code = $1',
      [type_code]
    );
    if (typeResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erreur: 'Type de demande inconnu' });
    }
    const typeDemandeId = typeResult.rows[0].id;

    const demandeId = uuidv4();
    await client.query(
      `INSERT INTO demandes
         (id, type_demande_id, auteur_id, destinataire_id, conversation_id, montant, devise_code, champs_valeurs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [demandeId, typeDemandeId, auteurId, superieurId, conversation_id, montant || null, devise_code || null, champs_valeurs]
    );

    const messageId = uuidv4();
    await client.query(
      `INSERT INTO messages (id, conversation_id, auteur_id, type, demande_id)
       VALUES ($1, $2, $3, 'demande', $4)`,
      [messageId, conversation_id, auteurId, demandeId]
    );

    await client.query(
      `INSERT INTO notifications (utilisateur_id, type, reference_id)
       VALUES ($1, 'nouvelle_demande', $2)`,
      [superieurId, demandeId]
    );

    await client.query('COMMIT');

    logger.info('Demande créée', { demandeId, auteurId, superieurId, type_code });

    const demandeComplete = await db.query(
      'SELECT * FROM vue_demandes_utilisateur WHERE id = $1',
      [demandeId]
    );

    // Diffusion temps réel via Socket.io (io attaché à l'app dans server.js)
    const io = req.app.get('io');
    io.to(`conversation:${conversation_id}`).emit('nouveau_message', { messageId, demandeId, type: 'demande' });
    io.to(`utilisateur:${superieurId}`).emit('nouvelle_demande', demandeComplete.rows[0]);

    return res.status(201).json({ demande: demandeComplete.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/**
 * Valide ou refuse une demande. L'autorisation (le demandeur est bien
 * le destinataire, et la demande est encore en_attente) est déjà
 * vérifiée par le middleware verifierDestinataireDemande.
 */
function traiterDemande(nouveauStatut) {
  return async function (req, res, next) {
    const erreurs = validationResult(req);
    if (!erreurs.isEmpty()) {
      return res.status(400).json({ erreurs: erreurs.array() });
    }

    const { demandeId } = req.params;
    const { commentaire } = req.body;
    const traiteParId = req.utilisateur.id;

    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      const avantResult = await client.query('SELECT statut, auteur_id FROM demandes WHERE id = $1 FOR UPDATE', [demandeId]);
      const ancienStatut = avantResult.rows[0].statut;
      const auteurId = avantResult.rows[0].auteur_id;

      await client.query(
        `UPDATE demandes SET statut = $1, commentaire_validation = $2, traite_le = now() WHERE id = $3`,
        [nouveauStatut, commentaire || null, demandeId]
      );

      await client.query(
        `INSERT INTO demande_historique (demande_id, ancien_statut, nouveau_statut, modifie_par, commentaire)
         VALUES ($1, $2, $3, $4, $5)`,
        [demandeId, ancienStatut, nouveauStatut, traiteParId, commentaire || null]
      );

      await client.query(
        `INSERT INTO notifications (utilisateur_id, type, reference_id)
         VALUES ($1, $2, $3)`,
        [auteurId, nouveauStatut === 'validee' ? 'demande_validee' : 'demande_refusee', demandeId]
      );

      await client.query('COMMIT');

      logger.info('Demande traitée', { demandeId, nouveauStatut, traiteParId });

      const demandeMaj = await db.query('SELECT * FROM vue_demandes_utilisateur WHERE id = $1', [demandeId]);

      const io = req.app.get('io');
      io.to(`utilisateur:${auteurId}`).emit('demande_traitee', demandeMaj.rows[0]);
      if (demandeMaj.rows[0].conversation_id) {
        io.to(`conversation:${demandeMaj.rows[0].conversation_id}`).emit('demande_mise_a_jour', demandeMaj.rows[0]);
      }

      return res.json({ demande: demandeMaj.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  };
}

/** Liste des demandes reçues par l'utilisateur connecté (à valider). */
async function listerDemandesRecues(req, res, next) {
  try {
    const result = await db.query(
      `SELECT * FROM vue_demandes_utilisateur
       WHERE destinataire_id = $1
       ORDER BY cree_le DESC`,
      [req.utilisateur.id]
    );
    return res.json({ demandes: result.rows });
  } catch (err) {
    next(err);
  }
}

/** Liste des demandes envoyées par l'utilisateur connecté (historique). */
async function listerDemandesEnvoyees(req, res, next) {
  try {
    const result = await db.query(
      `SELECT * FROM vue_demandes_utilisateur
       WHERE auteur_id = $1
       ORDER BY cree_le DESC`,
      [req.utilisateur.id]
    );
    return res.json({ demandes: result.rows });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  creerDemande,
  validerDemande: traiterDemande('validee'),
  refuserDemande: traiterDemande('refusee'),
  listerDemandesRecues,
  listerDemandesEnvoyees,
  validationCreationDemande,
  validationTraitementDemande,
};
