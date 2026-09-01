const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/conversationController');
const { authentifier } = require('../middleware/auth');
const { verifierMembreConversation, verifierAdminGroupe } = require('../middleware/autorisation');

router.use(authentifier);

router.get('/', ctrl.listerConversations);
router.post('/groupes', ctrl.validationCreationGroupe, ctrl.creerGroupe);

router.get('/:conversationId/messages', verifierMembreConversation, ctrl.listerMessages);
router.post('/:conversationId/messages', verifierMembreConversation, ctrl.validationEnvoiMessage, ctrl.envoyerMessage);

router.post('/:conversationId/membres', verifierAdminGroupe, ctrl.ajouterMembreGroupe);
router.delete('/:conversationId/membres/:membreId', verifierAdminGroupe, ctrl.retirerMembreGroupe);

module.exports = router;
