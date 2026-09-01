const winston = require('winston');

// Logger centralisé. Ne jamais logger de mots de passe, tokens ou
// données sensibles — seulement des identifiants et événements.
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/erreurs.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combine.log' }),
  ],
});

module.exports = logger;
