# SIMES API – Exemples de Requêtes

## 1. AUTHENTIFICATION

### Login
```json
POST /auth/login
Content-Type: application/json

{
  "email": "admin@simes.bf",
  "password": "admin1234"
}
```

**Réponse (200):**
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "d717a08d-23d5-4574-8b41-cdced5920850",
    "email": "admin@simes.bf",
    "name": "SIMES Admin",
    "role": "platform_super_admin",
    "orgId": null,
    "siteAccess": [],
    "avatar": ""
  }
}
```

### Get Current User
```
GET /auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 2. INGESTION (UG67 / Milesight)

### UG67 Batch Payload
```json
POST /ingest/ug67
Content-Type: application/json

{
  "gateway": {
    "id": "UG67-OUAGA-01",
    "ts_batch_start": "2026-03-02T00:30:42.875Z",
    "ts_batch_end": "2026-03-02T00:31:42.875Z"
  },
  "window_sec": 600,
  "devices": [
    {
      "devEUI": "00956906000b12d7",
      "meta": {
        "lastSeen": "2026-03-02T00:31:09.913Z",
        "deviceName": "SIMES 3"
      },
      "radio": {
        "rssi": -31,
        "snr": 13.8,
        "fcnt": 97,
        "time": "2026-03-02T00:31:07.807388Z"
      },
      "snapshot": {
        "Ua": 214.2,
        "Ub": 214.3,
        "Uc": 214.3,
        "Ia": 2.5,
        "Ib": 2.3,
        "Ic": 2.4,
        "P": 1650,
        "Q": 450,
        "S": 1710,
        "Pf": 0.96,
        "EP": 12450,
        "EPI": 10200,
        "EPE": 2250,
        "UaTHD": 5.79,
        "UbTHD": 5.89,
        "UcTHD": 5.69,
        "IaTHD": 8.2,
        "IbTHD": 7.9,
        "IcTHD": 8.1,
        "VUB": 0.04,
        "CUB": 0,
        "CT": 300,
        "PT": 1,
        "applicationID": 1,
        "deviceName": "SIMES 3"
      }
    },
    {
      "devEUI": "00956906000b34a2",
      "meta": {
        "lastSeen": "2026-03-02T00:31:10.050Z",
        "deviceName": "SIMES 4"
      },
      "radio": {
        "rssi": -28,
        "snr": 14.2,
        "fcnt": 156,
        "time": "2026-03-02T00:31:08.125Z"
      },
      "snapshot": {
        "Ua": 215.1,
        "Ub": 215.0,
        "Uc": 214.9,
        "Ia": 1.2,
        "Ib": 1.3,
        "Ic": 1.1,
        "P": 780,
        "Q": 210,
        "S": 810,
        "Pf": 0.96,
        "EP": 6540,
        "EPI": 5490,
        "EPE": 1050,
        "UaTHD": 5.5,
        "UbTHD": 5.4,
        "UcTHD": 5.6,
        "IaTHD": 6.5,
        "IbTHD": 6.8,
        "IcTHD": 6.3,
        "VUB": 0.03,
        "CUB": 0,
        "CT": 300,
        "PT": 1,
        "applicationID": 1,
        "deviceName": "SIMES 4"
      }
    }
  ]
}
```

### Chirpstack Payload (alternativ)
```json
POST /ingest/chirpstack
Content-Type: application/json

{
  "applicationID": "1",
  "applicationName": "SIMES",
  "deviceName": "SIMES 3",
  "devEUI": "00956906000b12d7",
  "deviceStatusBattery": 255,
  "deviceStatusMargin": 10,
  "data": "AhNWBaYC1gA6AEsAkwACABEA...",
  "objectJSON": {
    "Ua": 214.2,
    "Ub": 214.3,
    "Uc": 214.3,
    "Ia": 2.5,
    "P": 1650
  },
  "rxInfo": [
    {
      "gatewayID": "aa555a0055aa5a05",
      "rssi": -31,
      "loRaSNR": 13.8,
      "timestamp": 1677754267000
    }
  ],
  "txInfo": {
    "frequency": 868300000,
    "dr": 5
  },
  "fCnt": 97,
  "adr": true,
  "time": "2026-03-02T00:31:07.807388Z"
}
```

---

## 3. ADMIN

### Create/Map Device
```json
PUT /admin/devices/00956906000b12d7/map
Content-Type: application/json
Authorization: Bearer <token>

{
  "point_name": "Charge Principale",
  "measure_category": "LOAD",
  "terrain_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Create Measurement Point
```json
POST /admin/measurement-points
Content-Type: application/json
Authorization: Bearer <token>

{
  "terrain_id": "550e8400-e29b-41d4-a716-446655440000",
  "zone_id": "650e8400-e29b-41d4-a716-446655440111",
  "name": "Charge Principale",
  "device": "ADW300",
  "measure_category": "LOAD",
  "lora_dev_eui": "00956906000b12d7",
  "modbus_addr": null,
  "meta": {
    "ct_ratio": 300,
    "pt_ratio": 1
  }
}
```

### Provision Gateway
```json
POST /admin/gateways/ug67-ouaga-01/provision
Content-Type: application/json
Authorization: Bearer <token>

{
  "gateway_id": "UG67-OUAGA-01",
  "site_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Concentrateur OUAGA-01",
  "gateway_model": "Milesight"
}
```

### List Devices
```
GET /admin/gateways/ug67-ouaga-01/devices
Authorization: Bearer <token>
```

---

## 4. REFERENTIAL (Org/Sites/Terrains)

### List Organizations
```
GET /orgs
Authorization: Bearer <token>
```

### List Sites
```
GET /sites
Authorization: Bearer <token>
```

### List Terrains
```
GET /terrains
Authorization: Bearer <token>
```

### List Measurement Points
```
GET /points?terrain_id=550e8400-e29b-41d4-a716-446655440000
Authorization: Bearer <token>
```

---

## 5. RESULTS (Données en temps réel)

### Get Latest Reading
```
GET /readings/latest?point_id=550e8400-e29b-41d4-a716-446655440000
Authorization: Bearer <token>
```

**Réponse:**
```json
{
  "ok": true,
  "count": 1,
  "readings": [
    {
      "point_id": "550e8400-e29b-41d4-a716-446655440000",
      "time": "2026-03-02T00:31:09.000Z",
      "active_power_total": 1650,
      "reactive_power_total": 450,
      "power_factor_total": 0.96,
      "voltage_a": 214.2,
      "voltage_b": 214.3,
      "voltage_c": 214.3,
      "current_a": 2.5,
      "current_b": 2.3,
      "current_c": 2.4,
      "energy_import": 12450.5,
      "energy_export": 2250.3,
      "frequency": 50.0
    }
  ]
}
```

### Get Dashboard Data
```
GET /dashboard?terrain_id=550e8400-e29b-41d4-a716-446655440000
Authorization: Bearer <token>
```

---

## 6. JOBS (Rapports, facturation)

### Submit Facture Calculation
```json
POST /submit-facture
Content-Type: application/json
Authorization: Bearer <token>

{
  "terrain_id": "550e8400-e29b-41d4-a716-446655440000",
  "subscribed_power_kw": 100
}
```

**Réponse:**
```json
{
  "ok": true,
  "id": "job-uuid-12345",
  "status": "pending"
}
```

### Get Facture Result
```
GET /facture-result?job_id=job-uuid-12345
Authorization: Bearer <token>
```

---

## 7. HEALTH

### Health Check
```
GET /health
```

**Réponse:**
```json
{
  "ok": true,
  "status": "healthy",
  "timestamp": "2026-03-02T00:31:10Z"
}
```

---

## Headers Standard

```
Authorization: Bearer <jwt_token>
Content-Type: application/json
Accept: application/json
```

## Erreurs Courantes

```json
{
  "ok": false,
  "error": "User not found"
}
```

```json
{
  "ok": false,
  "reason": "invalid",
  "error": "Invalid email or password"
}
```

```json
{
  "ok": false,
  "reason": "locked",
  "locked_until": "2026-03-02T00:35:10Z",
  "error": "Account locked after 5 failed attempts"
}
```
