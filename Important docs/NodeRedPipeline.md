# Diagramme détaillé du Flow Node-RED

## 🔑 Vue d'ensemble

**Node-RED s'exécute sur la passerelle Milesight UG67** (edge computing). Il reçoit les uplinks LoRaWAN des compteurs Acrel, normalise, fusionne les snapshots, et envoie des **batches cohérents** au backend toutes les 10 minutes.

```
Compteurs Acrel (LoRaWAN)
        │
        ▼
   UG67 Gateway
        │
        ├─► Ingestion Service (Express 3001)
        │   → Normalise pour sa base (autre format)
        │   → Valide contre core-db
        │
        └─► Node-RED (ce pipeline)
            → Normalise pour batch (UG67-optimisé)
            → Fusionne multi-paquets
            → Envoie batch HTTP toutes les 10 min
            → Retry queue si backend down
```

---

## Vue globale du pipeline

```
                ┌──────────────────┐
                │   LoRaWAN In     │
                │ (UG67 Gateway)   │
                └─────────┬────────┘
                          │
                          ▼
                ┌──────────────────┐
                │   Normalize      │
                │  (Function)      │
                └─────────┬────────┘
                          │
                          ▼
                ┌──────────────────┐
                │   Merge State    │
                │  (Function)      │
                └─────────┬────────┘
                          │
                          │
                ┌─────────▼────────┐
                │  Stockage état   │
                │  flow.states     │
                └─────────┬────────┘
                          │
                          │
         ┌────────────────┴───────────────┐
         │                                │
         ▼                                ▼

 ┌───────────────┐                ┌────────────────┐
 │ Inject 10 min │                │ Inject 1 min   │
 │ Build Batch   │                │ Retry Queue    │
 └───────┬───────┘                └───────┬────────┘
         │                                │
         ▼                                ▼
 ┌───────────────┐                ┌────────────────┐
 │ Build Batch   │                │ Queue Pop      │
 │ (Function)    │                │ (Function)     │
 └───────┬───────┘                └───────┬────────┘
         │                                │
         ▼                                ▼
      HTTP Prep                        HTTP Prep
         │                                │
         ▼                                ▼
     HTTP Request                     HTTP Request
         │                                │
         ▼                                ▼
      Switch OK?                       Switch OK?
         │                                │
         ▼                                ▼
     SUCCESS                        Queue Commit
         │
         ▼
     Queue Push (si erreur)
```

---

# Étape 1 — Réception LoRaWAN

## Node

```
LoRaWAN In
```

Ce node reçoit les **uplinks LoRaWAN depuis la gateway UG67**.

Exemple de message reçu :

```json
{
  "deveui": "00956906000b12d7",
  "object": {
    "Ua": 207.4,
    "Ub": 207.5,
    "Uc": 207.5
    //Other metrics
  },
  "rssi": -30,
  "snr": 9,
  "freq": 868500000,
  "fcnt": 34
}
```

---

# Étape 2 — Normalize

## Node

```
Function : Normalize
```

Objectif :

Transformer le message LoRaWAN en **format interne standardisé**.

## Code

```javascript
var GW_ID = "UG67-OUAGA-01";

if (!msg.deveui) {
  return null;
}

msg.norm = {
  devEUI: ("" + msg.deveui).toLowerCase(),
  ts: new Date().toISOString(),

  gateway: {
    id: GW_ID
  },

  radio: {
    rssi: msg.rssi,
    snr: msg.snr,
    freq: msg.freq,
    fcnt: msg.fcnt,
    fport: msg.fport
  },

  data: msg.object || {}
};

return msg;
```

Résultat :

```json
{
 "norm":{
   "devEUI":"00956906000b12d7",
   "gateway":{"id":"UG67-OUAGA-01"},
   "radio":{...},
   "data":{...}
 }
}
```

---

# Étape 3 — Fusion des données (Merge State)

Le compteur **ADW300 envoie plusieurs paquets**.

Donc on fusionne les données.

## Node

```
Function : Merge State
```

## Code

```javascript
var e = msg.norm;
if (!e) return null;

var states = flow.get("states") || {};
var st = states[e.devEUI] || {
  devEUI: e.devEUI,
  data: {},
  meta: {},
  radio: {}
};

for (var k in e.data) {
  st.data[k] = e.data[k];
}

st.meta.lastSeen = e.ts;
st.meta.gatewayId = e.gateway.id;

st.radio = e.radio;

states[e.devEUI] = st;

flow.set("states", states);

return null;
```

Stockage interne :

```
flow.states
```

Structure :

```
states = {

 devEUI1 : {
   data : {...},
   meta : {...},
   radio : {...}
 }

}
```

---

# Étape 4 — Construction du Batch

Toutes les **10 minutes**.

## Node

```
Inject
Repeat : every 10 minutes
```

---

## Function : Build Batch

```javascript
var GW_ID = "UG67-OUAGA-01";

var states = flow.get("states") || {};

var now = new Date();
var end = now.toISOString();
var start = new Date(now.getTime() - 600000).toISOString();

var devices = [];

for (var dev in states) {

  var st = states[dev];

  devices.push({
    devEUI: st.devEUI,
    meta: st.meta,
    radio: st.radio,
    snapshot: st.data
  });

}

msg.payload = {
  gateway:{
    id:GW_ID,
    ts_batch_start:start,
    ts_batch_end:end
  },

  window_sec:600,
  devices:devices
};

return msg;
```

---

# Étape 5 — Préparation HTTP

## Node

```
Function : HTTP Prep
```

```javascript
msg.headers = {
 "Content-Type":"application/json",
 "X-Gateway-Id":msg.payload.gateway.id
};

return msg;
```

---

# Étape 6 — Envoi Backend

## Node

```
HTTP Request
```

Configuration :

```
Method : POST
URL : https://backend/ingest/milesight
```

---

# Étape 7 — Vérification du statut

## Node

```
Switch
```

Condition :

```
msg.statusCode >= 200
msg.statusCode < 300
```

---

# Étape 8 — File d’attente (Queue)

Si l'envoi échoue.

## Function : Queue Push

```javascript
var q = flow.get("queue") || [];

q.push(msg.payload);

flow.set("queue",q);

return null;
```

---

# Étape 9 — Worker de retransmission

Toutes les **60 secondes**.

## Inject

```
Repeat : every 1 minute
```

---

## Function : Queue Pop

```javascript
var q = flow.get("queue") || [];

if(q.length===0){
 return null;
}

var batch = q[0];

msg.payload = batch;

return msg;
```

---

# Étape 10 — Validation de l’envoi

Si l'envoi réussit.

## Function : Queue Commit

```javascript
var q = flow.get("queue") || [];

if(q.length>0){
 q.shift();
}

flow.set("queue",q);

return null;
```

---

# Résultat du système

Le pipeline Node-RED permet :

✔ réception LoRaWAN
✔ fusion des paquets
✔ création de snapshots cohérents
✔ envoi batch vers backend
✔ tolérance aux pannes Internet

---

# 🏗️ Architecture Decision Record (ADR)

## Décision : Edge Computing avec Node-RED sur UG67

### Contexte
Les compteurs Acrel envoient 60+ lectures simultanément via LoRa. Normaliser et envoyer message par message au backend = **bande passante gaspillée** et latence élevée.

### Alternatives considérées

| Approche | Avantage | Inconvénient |
|----------|----------|------------|
| **Node-RED sur UG67** (✅ choisi) | Batching 10min, edge processing, buffering réseau | État volatil actuellement, logs limités |
| Webhook direct vers Express | Simple, peu de dépendances | Pas d'agrégation, pas d'optimisation |
| Kafka sur gateway | Scaling, durable, observable | Complexité, ressources (UG67 limitée) |
| Cloud serverless (AWS Lambda) | Scalable, maintenu | Latence internet, coûts, dépendance cloud |

### Résultat & justification
**Node-RED sur UG67** avec queue de retry local :
- ✅ Batching 10 min = **~600x réduction messages** (60 compteurs × 10 min)
- ✅ Fusion des paquets = snapshots cohérents (Acrel envoie multi-fragment)
- ✅ Résilience réseau (queue locale si backend down)
- ✅ UG67 a CPU + RAM suffisant (Node.js compatible)

### Limitations acceptées (à fin mois 2)
- ⚠️ État en mémoire (volatil) — pas de backup actuellement
- ⚠️ Monitoring zéro — improvement future
- ⚠️ Pas de HA/failover — seule instance par gateway

---

# 🔀 Dualité des normalisations

## Pourquoi 2 services normalisent ?

```
ingestion-service (Express)          │  Node-RED (UG67)
────────────────────────────────────┼────────────────────────────────
Entrée: /milesight webhook          │  Entrée: LoRaWAN uplink
Normalise: pour core-db schema      │  Normalise: pour batch HTTP
Valide: contre base de données      │  Teste: codec ADW3000
Répond au webhook                    │  Envoie batch POST /ingest/milesight
  │                                  │    │
  └─► INSERT acrel_readings         │    └─► Reçu par ingestion-service
      └─► Déclenche workers         │        └─► Parsé + INSERT acrel_readings
```

**Pas de conflit** : 
- **Node-RED** prépare le **transport** (batching, fusionne multi-paquets)
- **ingestion-service** prépare le **stockage** (validation contre core-db)

Deux responsabilités différentes, deux normalisations différentes.

---

# ⚠️ État volatil & limites acceptées

## État en mémoire (flow context)

Actuellement :
```javascript
flow.set("states", {...});   // ❌ Perte si redémarrage
flow.set("queue", [...]);    // ❌ Perte si redémarrage
```

### Impact réel

| Scénario | Données perdues | Conséquence |
|----------|-----------------|-----------|
| UG67 redémarre (reboot, update) | États non envoyés ( < 10 min) | Trou de 10 min dans agrégation, acceptable |
| Queue > 100 (backend offline 2h) | Batch en attente (en mémoire) | Donn. restent sur Acrel ; manual recovery possible |

### Acceptation du risque
- **RTO** (Recovery Time Objective) : ~10 minutes (prochain batch)
- **Donn. non écrites en DB** : jamais perdues côté Acrel (persiste dans compteur)
- **Improbable** : UG67 rarement redémarrée en opération

### Amélioration future (backlog)
Persister queue en SQLite local si criticité augmente :
```javascript
// À implémenter
function saveQueueToSQLite(q) { ... }
function loadQueueFromSQLite() { ... }
```

---

# 🔗 Fusion des paquets (Merge State)

## Comportement design

Un compteur Acrel ADW3000 envoie souvent **plusieurs paquets LoRa** (multi-fragmenté) :

```
10:00:00 — Paquet 1 {Ua, Ub, Uc}
10:00:05 — Paquet 2 {Ia, Ib, Ic}
10:00:10 — Paquet 3 {P, E}
```

### Comment merge() fonctionne
```javascript
// Chaque nouvel uplink arrive
for (var k in e.data) {
  st.data[k] = e.data[k];    // Fusion incrémentale
}
```

### Et si un paquet arrive après le batch (10 min) ?
```
10:00:00 — Paquet 1 ✓ → Batch 1 (10:10)
10:00:15 — Paquet 2 ✓ → Batch 1 (inclus)
10:10:05 — Paquet 3 (LATE) ✓ → sera dans Batch 2 (10:20) ✔️
```

**C'est prévu par design** : Les données tardives seront toujours insérées, juste 10 min plus tard. Pas de perte, délai acceptable.

---

# 📦 Codec Acrel (ADW3000)

## Versioning & schéma

Le codec est défini dans [ADW3000Codec.js](../ADW3000Codec.js) :
- ✅ Maîtrisé (créé en interne)
- ✅ Versioning : filename explicite si évolution (ADW3100Codec.js)
- ✅ Mapping fixe : colonnes telemetry-db ↔ champs Acrel
- ✅ Validation : checks de plausibilité (Ua ∈ [0, 300]V, etc.)

**Pas de risque de breaking change** : chaque version de codec = new class.

---

# 🚀 Roadmap & Améliorations futures

| Amélioration | Impact | Effort | État |
|--------------|--------|--------|------|
| Persistance queue (SQLite) | Réduit data loss | ⭐ Faible | Backlog |
| Node-RED healthcheck endpoint | Détecte hang | ⭐ Faible | Backlog |
| Monitoring metrics (prometheus) | Visibilité ops | ⭐⭐ Moyen | Backlog |
| Backoff exponentiel retry | Résilience réseau | ⭐ Faible | Backlog |
| DLQ (dead-letter queue) | Audit & recovery | ⭐⭐ Moyen | Backlog |
| HA (2 gateways failover) | Zero downtime | 🔴 Fort | Pas prévu |

### Monitoring (future implementation)
Quand prioritisé, exposer :
```javascript
// Endpoints à implémenter
GET /node-red/health 
  → { alive, queue_size, uptime_sec, batch_count }

GET /node-red/metrics 
  → { batches_sent, errors_count, latency_p99_ms, memory_mb }
```

---

# Schéma final simplifié

```
LoRaWAN
   │
   ▼
UG67 Gateway
   │
   ▼
Node-RED (ce pipeline)
   │
   ├ Normalize      (standardize format)
   ├ Merge State    (fusionne multi-paquets)
   ├ Batch Builder  (tous les 10 min)
  ├ HTTP Sender    (POST /ingest/milesight)
   └ Retry Queue    (si erreur backend)
   │
   ▼
Backend (ingestion-service Express)
   │
   ├ Normalise      (pour schema core-db)
   ├ Valide         (checks DB)
   └ INSERT         (acrel_readings telemetry-db)
```
