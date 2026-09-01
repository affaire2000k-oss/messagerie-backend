const express = require('express');
const router = express.Router();
const demandeController = require('../controllers/demandeController');
const { authentifier } = require('../middleware/auth');
const { verifierDestinataireDemande } = require('../middleware/autorisation');

router.use(authentifier);

router.post('/', demandeController.validationCreationDemande, demandeController.creerDemande);
router.get('/recues', demandeController.listerDemandesRecues);
router.get('/envoyees', demandeController.listerDemandesEnvoyees);

router.post(
  '/:demandeId/valider',
  demandeController.validationTraitementDemande,
  verifierDestinataireDemande,
  demandeController.validerDemande
);

router.post(
  '/:demandeId/refuser',
  demandeController.validationTraitementDemande,
  verifierDestinataireDemande,
  demandeController.refuserDemande
);

module.exports = router;
