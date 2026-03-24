
# Infrastructure VPN Industrielle
## Accès sécurisé aux sites IoT et énergétiques

Projet : SIMES-BF  
Architecture : VPN centralisé  
Technologie : WireGuard  
Version : 1.1  
Auteur : Infrastructure Team

---

# 1. Vue d’ensemble

Cette infrastructure permet d'accéder de manière **sécurisée et centralisée** aux équipements industriels situés sur des sites distants.

Les équipements concernés peuvent inclure :

- gateways IoT
- infrastructures LoRaWAN
- équipements énergétiques
- capteurs et automates industriels

L'objectif est d'éviter toute **exposition directe de ces équipements sur Internet**.

---

# 2. Objectifs de l’architecture

## Sécurité

- isolation des équipements terrain
- chiffrement des communications
- authentification par clés publiques

## Exploitation

- accès distant sécurisé
- maintenance des équipements
- supervision centralisée

## Scalabilité

- ajout simple de nouveaux sites
- ajout d'utilisateurs
- extension multi-réseaux

---

# 3. Architecture réseau

## Architecture Hub & Spoke

Le système repose sur un **serveur central VPN (VPS)** qui agit comme **point de convergence des tunnels VPN**.

```

```
                    INTERNET
                        │
                        │
                ┌────────────────┐
                │ VPS VPN SERVER │
                │   10.10.10.1   │
                └───────┬────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        │               │               │
    ADMIN PC        TECHNICIAN      SITE GATEWAY
    10.10.10.10     10.10.10.20     10.10.10.2
                                          │
                                          │
                                   LOCAL NETWORK
                                   192.168.10.0/24
```

```

---

# 4. Plan d’adressage

## Réseau VPN

```

10.10.10.0/24

```

| Node | Adresse |
|-----|------|
VPS | 10.10.10.1  
Gateway site | 10.10.10.2  
Administrateur | 10.10.10.10  
Technicien | 10.10.10.20  

---

# 5. Architecture multi-sites

Le système peut connecter plusieurs sites industriels.

```

```
            VPS VPN HUB
             10.10.10.1
                  │
 ┌────────────────┼────────────────┐
 │                │                │
 │                │                │
```

SITE A           SITE B           SITE C
10.10.10.2        10.10.10.3       10.10.10.4
192.168.10.0      192.168.20.0     192.168.30.0

```

Chaque site possède :

- un tunnel VPN
- un réseau local distinct
- un accès sécurisé depuis le VPS

---

# 6. Choix technologique

VPN utilisé :

**WireGuard**

Avantages :

| Critère | Description |
|------|------|
Performance | très faible latence |
Sécurité | cryptographie moderne |
Code | base de code minimale |
Configuration | simple |
Stabilité | intégré au kernel Linux |

---

# 7. Installation du serveur VPN

Installation sur VPS Linux.

```

sudo apt update
sudo apt install wireguard

```

---

# 8. Génération des clés

Chaque peer possède :

- une clé privée
- une clé publique

Commande :

```

wg genkey | tee privatekey | wg pubkey > publickey

```

---

# 9. Configuration du serveur

Fichier :

```

/etc/wireguard/wg0.conf

```

Exemple :

```

[Interface]

Address = 10.10.10.1/24
ListenPort = 51820
PrivateKey = VPS_PRIVATE_KEY

# Gateway Site

[Peer]
PublicKey = SITE_KEY
AllowedIPs = 10.10.10.2/32, 192.168.10.0/24

# Admin

[Peer]
PublicKey = ADMIN_KEY
AllowedIPs = 10.10.10.10/32

# Technicien

[Peer]
PublicKey = TECH_KEY
AllowedIPs = 10.10.10.20/32

```

---

# 10. Activation du VPN

```

sudo systemctl start wg-quick@wg0
sudo systemctl enable wg-quick@wg0

```

Vérification :

```

sudo wg

```

---

# 11. Routage du trafic

Activation du forwarding :

```

sudo sysctl -w net.ipv4.ip_forward=1

```

Configuration permanente :

```

/etc/sysctl.conf

```

Ajouter :

```

net.ipv4.ip_forward=1

```

---

# 12. Configuration firewall

Autoriser le forwarding :

```

sudo iptables -A FORWARD -i wg0 -j ACCEPT
sudo iptables -A FORWARD -o wg0 -j ACCEPT

```

---

# 13. Persistance des règles

```

sudo apt install iptables-persistent
sudo netfilter-persistent save

```

---

# 14. Configuration gateway terrain

Sur la gateway LoRaWAN :

Interface WireGuard :

```

IP Address : 10.10.10.2/24

```

Peer :

| Paramètre | Valeur |
|------|------|
PublicKey | VPS_PUBLIC_KEY |
Endpoint | VPS_IP:51820 |
AllowedIPs | 10.10.10.0/24 |

---

# 15. Configuration utilisateur

Exemple configuration client :

```

[Interface]

PrivateKey = USER_PRIVATE_KEY
Address = 10.10.10.20/24

[Peer]

PublicKey = VPS_PUBLIC_KEY
Endpoint = VPS_IP:51820
AllowedIPs = 10.10.10.0/24, 192.168.10.0/24
PersistentKeepalive = 25

```

---

# 16. Vérification du fonctionnement

Sur le serveur :

```

sudo wg

```

Exemple :

```

latest handshake: 15 seconds ago
transfer: 2.1 KiB received

```

Tests réseau :

```

ping 10.10.10.2
ping 192.168.10.1

```

---

# 17. Runbook d'exploitation

## Vérifier l'état du VPN

```

sudo wg

```

## Redémarrer le service

```

sudo systemctl restart wg-quick@wg0

```

## Vérifier le routage

```

ip route

```

---

# 18. Procédure ajout utilisateur

1. génération des clés
2. transmission de la clé publique
3. ajout dans la configuration serveur
4. attribution d'une IP VPN
5. redémarrage du service

---

# 19. Procédure ajout site

1. installer gateway
2. générer clés VPN
3. ajouter peer sur VPS
4. configurer réseau local

---

# 20. Monitoring

Commande principale :

```

sudo wg

```

Informations disponibles :

- handshake
- volume de trafic
- adresse peer

---

# 21. Bonnes pratiques de sécurité

## Gestion des clés

- ne jamais partager les clés privées
- stocker les clés sur un gestionnaire sécurisé

## Rotation des clés

Rotation recommandée :

- tous les 12 mois
- en cas de suspicion de compromission

---

# 22. Sauvegardes

Sauvegarder :

```

/etc/wireguard/

```

Inclure dans les backups du serveur.

---

# 23. Scénarios de panne

## Tunnel VPN inactif

Vérifier :

```

sudo wg

```

## Aucun trafic

Vérifier :

- firewall
- routing
- AllowedIPs

---

# 24. Scalabilité future

Cette architecture peut évoluer vers :

- supervision multi-sites
- collecte centralisée des données
- interconnexion de réseaux industriels

---

# 25. Conclusion

Cette architecture fournit :

- un accès sécurisé aux infrastructures terrain
- une gestion centralisée
- une base solide pour les infrastructures IoT industrielles

Le serveur VPN agit comme **hub sécurisé reliant les sites et les administrateurs**, permettant une maintenance fiable et sécurisée des équipements.
```
