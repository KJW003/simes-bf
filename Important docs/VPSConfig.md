> Contexte : VPS Hostinger, Ubuntu Server, avec **interfaces graphiques**.
> 

---

## 1) Informations VPS (à compléter)

- **Provider** : Hostinger
- **Hostname** : `srv1344732`
- **IP publique** : `[`[76.13.44.23](mailto:root@76.13.44.23)`]`
- **Plan VPS** : **2 vCPU / 8 GB RAM** ✅
- **OS** : Ubuntu Server (version : `[...]`)
- **Accès** : SSH “[root@76.13.44.23](mailto:root@76.13.44.23) / S3HiiV'-znZo7;;'yD9( “

---

## 2) Comptes / Utilisateurs (à remplir)

> Objectif : documenter qui a accès au serveur.
> 

### Utilisateurs système

- **root**
    - Rôle : administration (à éviter pour les opérations quotidiennes)
    - Accès : SSH / Cockpit (root refusé au début, puis Cockpit OK via user)
- **user principal (admin)** : `[simes / simes]`

### Accès Cockpit

- User utilisé pour Cockpit : `[simes / simes]`
- Url : 76.13.44.23:9090

### Accès Portainer

- User utilisé pour Portainer : `[admin  admin1234567]`
- Url : 76.13.44.23:9443

---

## 3) Vérifications déjà OK (Hostinger + Ubuntu)

### Docker

Docker est installé et actif

- Version : **Docker 29.2.1**
- Service : `docker.service` **running**
- Objectif : exécuter toute l’infra SIMES sous forme de conteneurs (Web, Backend, BD, etc.) pour un déploiement simple et reproductible.

Commandes de vérification utilisées :

- `docker --version`
- `docker compose version`
- `sudo systemctl status docker --no-pager`
- `docker ps`

Résultat :

- Docker fonctionne
- Aucun conteneur ne tournait au départ  (donc installation Portainer possible sans conflit)

---

## 4) Interface graphique serveur (Cockpit)

Cockpit installé et fonctionnel

### À quoi ça sert

- Avoir une **interface web** pour superviser le VPS :
    - CPU / RAM / stockage
    - services systemd (start/stop)
    - logs système
    - mises à jour
- Permet d’éviter une grosse partie du CLI.

### Note importante

- La connexion **root** peut être refusée (selon policy Ubuntu/Hostinger).
- Utiliser plutôt un **user admin avec sudo**.

---

## 5) Interface graphique Docker (Portainer)

Portainer installé et fonctionnel

### À quoi ça sert

- Gérer Docker **sans ligne de commande** :
    - démarrer/arrêter conteneurs
    - voir logs
    - gérer volumes, networks
    - déployer des stacks (docker-compose)
- C’est l’outil principal pour déployer SIMES (backend + web + plus tard DB).

### Installation réalisée

- Création volume de données Portainer :
    - `portainer_data` (stocke config + comptes Portainer)
- Lancement conteneur Portainer en restart automatique

Port exposé :

- **9443/tcp** → accès Portainer en HTTPS

Accès :

- URL : `https://IP_DU_VPS:9443`
- Compte admin Portainer : `[...]` (à compléter)

---

## 6) Ports / Réseau (à compléter)

> Objectif : savoir ce qui est ouvert et pourquoi.
> 
- **22/tcp (SSH)** : accès admin serveur
- **9090/tcp (Cockpit)** : interface web serveur *(si ouvert)*
- **9443/tcp (Portainer HTTPS)** : interface Docker ✅
- **80/443 (HTTP/HTTPS)** : futur site web + API SIMES *(à prévoir plus tard)*

---

## 7) Pourquoi ces choix (résumé simple)

- **Ubuntu + Docker** : stable, standard, facile à déployer/maintenir
- **Cockpit** : admin serveur en GUI
- **Portainer** : déploiement et gestion Docker en GUI → parfait si on n’aime pas le CLI
- On garde une base légère maintenant, puis on installe DB/Backend quand l’architecture est décidée.

---