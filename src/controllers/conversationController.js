const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

const validationEnvoiMessage = [
  param('conversationId').isUUID(),
  body('contenu').trim().isLength({ min: 1, max: 4000 }).escape(),
];

const validationCreationGroupe = [
  body('nom').trim().isLength({ min: 2, max: 150 }).escape(),
  body('membres_ids').isArray({ min: 1 }),
  body('membres_ids.*').isUUID(),
];

/** Liste les conversations de l'utilisateur connecté, triées par activité récente. */
async function listerConversations(req, res, next) {
  try {
    const result = await db.query(
      `SELECT c.id, c.type, c.nom,
              (SELECT m.contenu FROM messages m WHERE m.conversation_id = c.id ORDER BY m.envoye_le DESC LIMIT 1) AS dernier_message,
              (SELECT m.envoye_le FROM messages m WHERE m.conversation_id = c.id ORDER BY m.envoye_le DESC LIMIT 1) AS dernier_message_le
       FROM conversations c
       JOIN conversation_membres cm ON cm.conversation_id = c.id
       WHERE cm.utilisateur_id = $1
       ORDER BY dernier_message_le DESC NULLS LAST`,
      [req.utilisateur.id]
    );
    return res.json({ conversations: result.rows });
  } catch (err) {
    next(err);
  }
}

/** Historique paginé des messages d'une conversation (accès déjà vérifié par middleware). */
async function listerMessages(req, res, next) {
  const { conversationId } = req.params;
  const limite = Math.min(Number(req.query.limite) || 50, 100);
  const avant = req.query.avant || null; // curseur : timestamp du plus ancien message déjà chargé

  try {
    const result = await db.query(
      `SELECT m.id, m.auteur_id, m.type, m.contenu, m.envoye_le,
              d.id AS demande_id, d.statut AS demande_statut, d.montant, d.devise_code,
              d.champs_valeurs, td.libelle AS demande_type_libelle, td.icone AS demande_icone
       FROM messages m
       LEFT JOIN demandes d ON d.id = m.demande_id
       LEFT JOIN types_demande td ON td.id = d.type_demande_id
       WHERE m.conversation_id = $1
         AND ($2::timestamptz IS NULL OR m.envoye_le < $2)
       ORDER BY m.envoye_le DESC
       LIMIT $3`,
      [conversationId, avant, limite]
    );
    return res.json({ messages: result.rows.reverse() });
  } catch (err) {
    next(err);
  }
}

/** Envoie un message texte simple dans une conversation. */
async function envoyerMessage(req, res, next) {
  const erreurs = validationResult(req);
  if (!erreurs.isEmpty()) {
    return res.status(400).json({ erreurs: erreurs.array() });
  }

  const { conversationId } = req.params;
  const { contenu } = req.body;
  const auteurId = req.utilisateur.id;

  try {
    const messageId = uuidv4();
    const result = await db.query(
      `INSERT INTO messages (id, conversation_id, auteur_id, type, contenu)
       VALUES ($1, $2, $3, 'texte', $4)
       RETURNING id, auteur_id, type, contenu, envoye_le`,
      [messageId, conversationId, auteurId, contenu]
    );

    const io = req.app.get('io');
    io.to(`conversation:${conversationId}`).emit('nouveau_message', result.rows[0]);

    return res.status(201).json({ message: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

/** Crée un groupe sécurisé. Le créateur devient automatiquement admin. */
async function creerGroupe(req, res, next) {
  const erreurs = validationResult(req);
  if (!erreurs.isEmpty()) {
    return res.status(400).json({ erreurs: erreurs.array() });
  }

  const { nom, membres_ids } = req.body;
  const createurId = req.utilisateur.id;
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const conversationId = uuidv4();
    await client.query(
      `INSERT INTO conversations (id, type, nom, cree_par) VALUES ($1, 'groupe', $2, $3)`,
      [conversationId, nom, createurId]
    );

    // Le créateur est admin
    await client.query(
      `INSERT INTO conversation_membres (conversation_id, utilisateur_id, role) VALUES ($1, $2, 'admin')`,
      [conversationId, createurId]
    );

    // Les autres membres sont ajoutés en tant que 'membre'
    const membresUniques = [...new Set(membres_ids)].filter((id) => id !== createurId);
    for (const membreId of membresUniques) {
      await client.query(
        `INSERT INTO conversation_membres (conversation_id, utilisateur_id, role) VALUES ($1, $2, 'membre')
         ON CONFLICT DO NOTHING`,
        [conversationId, membreId]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ conversation_id: conversationId });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/** Ajoute un membre à un groupe (réservé aux admins — vérifié par middleware). */
async function ajouterMembreGroupe(req, res, next) {
  const { conversationId } = req.params;
  const { utilisateur_id } = req.body;

  if (!utilisateur_id) {
    return res.status(400).json({ erreur: 'utilisateur_id requis' });
  }

  try {
    await db.query(
      `INSERT INTO conversation_membres (conversation_id, utilisateur_id, role)
       VALUES ($1, $2, 'membre') ON CONFLICT DO NOTHING`,
      [conversationId, utilisateur_id]
    );
    const io = req.app.get('io');
    io.to(`conversation:${conversationId}`).emit('membre_ajoute', { utilisateur_id });
    return res.status(201).json({ succes: true });
  } catch (err) {
    next(err);
  }
}

/** Retire un membre d'un groupe (réservé aux admins). */
async function retirerMembreGroupe(req, res, next) {
  const { conversationId, membreId } = req.params;
  try {
    await db.query(
      `DELETE FROM conversation_membres WHERE conversation_id = $1 AND utilisateur_id = $2`,
      [conversationId, membreId]
    );
    const io = req.app.get('io');
    io.to(`conversation:${conversationId}`).emit('membre_retire', { utilisateur_id: membreId });
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listerConversations,
  listerMessages,
  envoyerMessage,
  creerGroupe,
  ajouterMembreGroupe,
  retirerMembreGroupe,
  validationEnvoiMessage,
  validationCreationGroupe,
};
