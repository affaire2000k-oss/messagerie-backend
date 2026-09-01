const fs = require('fs');
const path = require('path');
const db = require('./config/db');
const logger = require('./config/logger');

/**
 * Charge automatiquement le schéma SQL au démarrage si les tables
 * n'existent pas encore. Utile pour un premier déploiement sans
 * accès Shell (ex : plan gratuit Render). Sans danger à ré-exécuter :
 * si la table 'utilisateurs' existe déjà, la migration est sautée.
 */
async function migrerSiNecessaire() {
  try {
    const verif = await db.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'utilisateurs'
       )`
    );

    if (verif.rows[0].exists) {
      logger.info('Schéma déjà présent, migration ignorée');
      return;
    }

    const cheminSchema = path.join(__dirname, '..', 'schema.sql');
    const sql = fs.readFileSync(cheminSchema, 'utf8');

    logger.info('Aucune table détectée, chargement du schéma...');
    await db.query(sql);
    logger.info('Schéma chargé avec succès');
  } catch (err) {
    logger.error('Erreur lors de la migration automatique', { message: err.message });
    // On ne bloque pas le démarrage du serveur pour autant : si la
    // migration échoue, les routes renverront des erreurs explicites
    // et le problème sera visible dans les logs Render.
  }
}

module.exports = { migrerSiNecessaire };
