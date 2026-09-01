require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const logger = require('./config/logger');
const { limiteurGlobal } = require('./middleware/rateLimit');
const { initialiserSocket } = require('./sockets');

const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const demandeRoutes = require('./routes/demandes');

const app = express();
const server = http.createServer(app);

// ---------- CORS : origine strictement limitée à l'app connue ----------
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || false,
  credentials: true, // nécessaire pour envoyer le cookie refresh_token
};
app.use(cors(corsOptions));

const io = new Server(server, { cors: corsOptions });
app.set('io', io);
initialiserSocket(io);

// ---------- En-têtes de sécurité HTTP ----------
app.use(helmet());
app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));

// ---------- Middlewares de base ----------
app.use(express.json({ limit: '1mb' })); // limite la taille du payload
app.use(cookieParser());
app.use(limiteurGlobal);

// ---------- Routes ----------
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/demandes', demandeRoutes);

app.get('/api/sante', (req, res) => res.json({ statut: 'ok' }));

// Page de diagnostic simple, à ouvrir directement dans un navigateur,
// pour vérifier que les tables de la base de données existent bien.
app.get('/api/diagnostic', async (req, res) => {
  try {
    const db = require('./config/db');
    const result = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tables = result.rows.map((r) => r.table_name);
    res.json({
      base_de_donnees: tables.length > 0 ? 'Connectée et tables présentes ✅' : 'Connectée mais AUCUNE table trouvée ❌',
      nombre_de_tables: tables.length,
      tables,
    });
  } catch (err) {
    res.status(500).json({
      base_de_donnees: 'Erreur de connexion ❌',
      erreur: err.message,
    });
  }
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).json({ erreur: 'Ressource introuvable' });
});

// ---------- Gestionnaire d'erreurs global ----------
// Ne jamais renvoyer la stack trace ou le message brut d'une erreur
// SQL/interne au client -> évite de divulguer des détails d'implémentation.
app.use((err, req, res, next) => {
  logger.error('Erreur non gérée', { message: err.message, path: req.path });
  res.status(err.status || 500).json({
    erreur: process.env.NODE_ENV === 'production'
      ? 'Une erreur interne est survenue'
      : err.message,
  });
});

const { migrerSiNecessaire } = require('./migrate');

const PORT = process.env.PORT || 4000;

// La migration automatique du schéma s'exécute avant d'ouvrir le
// port, pour garantir que les tables existent dès la première requête.
migrerSiNecessaire().finally(() => {
  server.listen(PORT, () => {
    logger.info(`Serveur démarré sur le port ${PORT}`);
  });
});

module.exports = { app, server };
