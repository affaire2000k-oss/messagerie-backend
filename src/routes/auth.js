const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { limiteurConnexion } = require('../middleware/rateLimit');

router.post('/inscription', authController.validationInscription, authController.inscrire);
router.post('/connexion', limiteurConnexion, authController.validationConnexion, authController.connecter);
router.post('/rafraichir', authController.rafraichir);
router.post('/deconnexion', authController.deconnecter);

module.exports = router;
