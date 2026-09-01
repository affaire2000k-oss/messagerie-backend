-- =========================================================
-- SCHEMA BASE DE DONNEES — App Messagerie Entreprise
-- PostgreSQL 15+
-- =========================================================

-- ---------- EXTENSIONS ----------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------- ENUMS ----------
CREATE TYPE statut_demande AS ENUM ('en_attente', 'validee', 'refusee');
CREATE TYPE type_conversation AS ENUM ('directe', 'groupe');
CREATE TYPE role_groupe AS ENUM ('admin', 'membre');
CREATE TYPE type_message AS ENUM ('texte', 'demande', 'systeme');

-- ---------- UTILISATEURS ----------
CREATE TABLE utilisateurs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nom_complet     VARCHAR(150) NOT NULL,
    email           VARCHAR(150) UNIQUE NOT NULL,
    mot_de_passe_hash VARCHAR(255) NOT NULL,
    poste           VARCHAR(100),               -- ex: "Caissière", "Comptable"
    superieur_id    UUID REFERENCES utilisateurs(id) ON DELETE SET NULL, -- hiérarchie directe
    actif           BOOLEAN NOT NULL DEFAULT TRUE,
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_utilisateurs_superieur ON utilisateurs(superieur_id);

-- ---------- DEVISES ----------
CREATE TABLE devises (
    code        CHAR(3) PRIMARY KEY,   -- ex: GNF, USD, EUR
    libelle     VARCHAR(50) NOT NULL,
    symbole     VARCHAR(5) NOT NULL
);

INSERT INTO devises (code, libelle, symbole) VALUES
 ('GNF', 'Franc guinéen', 'FG'),
 ('USD', 'Dollar américain', '$'),
 ('EUR', 'Euro', '€');

-- ---------- TYPES DE DEMANDE (configurables) ----------
CREATE TABLE types_demande (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(50) UNIQUE NOT NULL,   -- ex: decaissement, conge, achat
    libelle     VARCHAR(100) NOT NULL,
    icone       VARCHAR(10),                   -- emoji/icone pour l'UI
    champs_schema JSONB NOT NULL               -- définit les champs du formulaire dynamique
);

INSERT INTO types_demande (code, libelle, icone, champs_schema) VALUES
 ('decaissement', 'Décaissement', '💵',
   '{"champs":[{"nom":"montant","type":"montant","requis":true},{"nom":"beneficiaire","type":"texte","requis":true},{"nom":"motif","type":"texte","requis":true},{"nom":"piece_jointe","type":"fichier","requis":false}]}'),
 ('conge', 'Congé', '🗓️',
   '{"champs":[{"nom":"date_debut","type":"date","requis":true},{"nom":"date_fin","type":"date","requis":true},{"nom":"type_conge","type":"choix","options":["annuel","maladie","exceptionnel"],"requis":true},{"nom":"motif","type":"texte","requis":false}]}'),
 ('achat', 'Achat', '🛒',
   '{"champs":[{"nom":"article","type":"texte","requis":true},{"nom":"montant_estime","type":"montant","requis":true},{"nom":"fournisseur","type":"texte","requis":false},{"nom":"justification","type":"texte","requis":true}]}');

-- ---------- CONVERSATIONS ----------
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type            type_conversation NOT NULL,
    nom             VARCHAR(150),                -- utilisé seulement pour les groupes
    cree_par        UUID REFERENCES utilisateurs(id),
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_membres (
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    utilisateur_id  UUID REFERENCES utilisateurs(id) ON DELETE CASCADE,
    role            role_groupe NOT NULL DEFAULT 'membre',  -- pertinent surtout pour les groupes
    rejoint_le      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, utilisateur_id)
);

CREATE INDEX idx_conv_membres_user ON conversation_membres(utilisateur_id);

-- ---------- MESSAGES ----------
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    auteur_id       UUID NOT NULL REFERENCES utilisateurs(id),
    type            type_message NOT NULL DEFAULT 'texte',
    contenu         TEXT,                        -- texte du message (NULL si type=demande pure)
    demande_id      UUID,                        -- lien vers la demande si type='demande' (FK ajoutée plus bas)
    envoye_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_le      TIMESTAMPTZ
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, envoye_le);

-- ---------- DEMANDES ----------
CREATE TABLE demandes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type_demande_id     INTEGER NOT NULL REFERENCES types_demande(id),
    auteur_id           UUID NOT NULL REFERENCES utilisateurs(id),
    destinataire_id     UUID NOT NULL REFERENCES utilisateurs(id),  -- = supérieur direct au moment de la création
    conversation_id     UUID REFERENCES conversations(id),
    statut              statut_demande NOT NULL DEFAULT 'en_attente',
    montant             NUMERIC(18,2),            -- NULL si le type n'a pas de montant (ex: congé)
    devise_code         CHAR(3) REFERENCES devises(code),
    champs_valeurs      JSONB NOT NULL DEFAULT '{}',  -- valeurs des champs dynamiques (beneficiaire, motif, dates...)
    piece_jointe_url    TEXT,
    commentaire_validation TEXT,
    cree_le             TIMESTAMPTZ NOT NULL DEFAULT now(),
    traite_le           TIMESTAMPTZ,

    CONSTRAINT chk_montant_devise CHECK (
        (montant IS NULL AND devise_code IS NULL) OR
        (montant IS NOT NULL AND devise_code IS NOT NULL)
    )
);

CREATE INDEX idx_demandes_destinataire ON demandes(destinataire_id, statut);
CREATE INDEX idx_demandes_auteur ON demandes(auteur_id);

ALTER TABLE messages
    ADD CONSTRAINT fk_messages_demande FOREIGN KEY (demande_id) REFERENCES demandes(id) ON DELETE SET NULL;

-- ---------- NOTIFICATIONS ----------
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    utilisateur_id  UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL,        -- ex: 'nouvelle_demande', 'demande_validee', 'nouveau_message'
    reference_id    UUID,                        -- id du message/demande concerné
    lu              BOOLEAN NOT NULL DEFAULT FALSE,
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_non_lu ON notifications(utilisateur_id, lu);

-- ---------- JOURNAL D'AUDIT DES DEMANDES ----------
CREATE TABLE demande_historique (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    demande_id      UUID NOT NULL REFERENCES demandes(id) ON DELETE CASCADE,
    ancien_statut   statut_demande,
    nouveau_statut  statut_demande NOT NULL,
    modifie_par     UUID NOT NULL REFERENCES utilisateurs(id),
    commentaire     TEXT,
    modifie_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- VUE UTILE : historique complet des demandes pour un utilisateur
-- =========================================================
CREATE VIEW vue_demandes_utilisateur AS
SELECT
    d.id,
    d.statut,
    td.libelle AS type_libelle,
    td.icone,
    d.montant,
    d.devise_code,
    d.auteur_id,
    u_auteur.nom_complet AS auteur_nom,
    d.destinataire_id,
    u_dest.nom_complet AS destinataire_nom,
    d.cree_le,
    d.traite_le
FROM demandes d
JOIN types_demande td ON td.id = d.type_demande_id
JOIN utilisateurs u_auteur ON u_auteur.id = d.auteur_id
JOIN utilisateurs u_dest ON u_dest.id = d.destinataire_id;
