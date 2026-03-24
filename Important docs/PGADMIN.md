# pgAdmin — Guide de Configuration

## Installation

pgAdmin est inclus dans le déploiement Docker et exposé directement sur le port hôte `5050`.

### Accès

Après avoir exécuté `./deploy.sh`, pgAdmin est disponible à :
```
http://localhost:5050
```

**Identifiants par défaut :**
- Email: `admin@simes.local`
- Mot de passe: `admin1234`

(À modifier dans `infra/docker/.env` avant le déploiement)

## Configuration des serveurs de base de données

### Étape 1 : Première connexion

1. Ouvre `http://localhost:5050`
2. Entre les identifiants ci-dessus
3. Configure les deux serveurs de base de données

### Étape 2 : Ajouter le serveur Core DB

Dans le left sidebar :
- Right-click sur **Servers**
- Clic sur **Register** → **Server**

**Onglet "Name":**
- Name: `SIMES Core`

**Onglet "Connection":**
| Champ | Valeur |
|-------|--------|
| Host name/address | `core-db` |
| Port | `5432` |
| Maintenance database | `simes_core` |
| Username | `simes` |
| Password | `simes` |
| Save password? | ✓ Yes |

Clic sur **Save**

### Étape 3 : Ajouter le serveur Telemetry DB

Répète la procdure avec :

**Onglet "Name":**
- Name: `SIMES Telemetry (TimescaleDB)`

**Onglet "Connection":**
| Champ | Valeur |
|-------|--------|
| Host name/address | `telemetry-db` |
| Port | `5432` |
| Maintenance database | `simes_telemetry` |
| Username | `simes` |
| Password | `simes` |
| Save password? | ✓ Yes |

Clic sur **Save**

## Audit des données

Une fois les serveurs configurés, tu peux exécuter des requêtes SQL pour auditer les données.

### Ouvrir le SQL Query Tool

1. Expand un serveur dans le sidebar
2. Right-click sur **Databases** → **simes_telemetry**
3. Clic sur **Tools** → **Query Tool**

### Requêtes utiles

**Compter les readings :**
```sql
SELECT COUNT(*) as total_readings FROM acrel_readings;
```

**Points de mesure avec données :**
```sql
SELECT COUNT(DISTINCT point_id) as points_with_data FROM acrel_readings;
```

**Plage temporelle des données :**
```sql
SELECT 
  MIN(time) as earliest,
  MAX(time) as latest,
  NOW() - MAX(time) as delay
FROM acrel_readings;
```

**Dernières 20 lectures :**
```sql
SELECT 
  time,
  point_id,
  active_power_total,
  voltage_a,
  current_a,
  frequency
FROM acrel_readings
ORDER BY time DESC
LIMIT 20;
```

**Valeurs NULL par colonne (data quality) :**
```sql
SELECT
  COUNT(*) as total_rows,
  COUNT(CASE WHEN voltage_a IS NULL THEN 1 END) as null_voltage_a,
  COUNT(CASE WHEN current_a IS NULL THEN 1 END) as null_current_a,
  COUNT(CASE WHEN active_power_total IS NULL THEN 1 END) as null_power_total,
  COUNT(CASE WHEN energy_import IS NULL THEN 1 END) as null_energy_import
FROM acrel_readings;
```

**Distribution par point :**
```sql
SELECT
  mp.name as point,
  COUNT(*) as reading_count,
  MIN(ar.time) as first_reading,
  MAX(ar.time) as last_reading
FROM acrel_readings ar
JOIN core_db.measurement_points mp ON ar.point_id = mp.id
GROUP BY ar.point_id, mp.name
ORDER BY reading_count DESC;
```

## Troubleshooting

### pgAdmin n'est pas accessible

Vérifie que le container est running :
```bash
docker ps | grep pgadmin
```

Si absent, redémarre les services :
```bash
cd infra/docker
docker compose up -d pgadmin
```

### Erreur de connexion au DB

Vérifie les credentials dans `.env` :
```bash
grep -E "DB_USER|DB_PASSWORD" infra/docker/.env
```

Les hostnames (`core-db`, `telemetry-db`) doivent matcher les container names Docker.

### Réinitialiser les credentials pgAdmin

```bash
cd infra/docker
docker compose exec pgadmin psql -U postgres -d pgadmin -c "
UPDATE pgagent_job SET jobname='reset' WHERE 1=0;
"
```

Ou redémarre proprement :
```bash
docker compose down pgadmin
docker compose up -d pgadmin
```

## TimescaleDB specifics

Telemetry DB utilise **TimescaleDB**, une extension PostgreSQL pour les séries temporelles.

Requête pour voir l'état des hypertables :
```sql
SELECT * FROM timescaledb_information.hypertables;
```

Voir les chunks (partitions) d'une hypertable :
```sql
SELECT * FROM timescaledb_information.chunks 
WHERE hypertable_name = 'acrel_readings';
```

Compression (améliore la performance) :
```sql
SELECT * FROM timescaledb_information.compressed_hypertable_stats;
```

## Export des données

pgAdmin permet d'exporter les résultats SQL en CSV/JSON/XML :

1. Exécute une requête dans Query Tool
2. Sélectionne les lignes ou fais un clic droit
3. **Download as CSV** / **Copy**

Exemple : exporter 1 jour de données
```sql
COPY (
  SELECT * FROM acrel_readings
  WHERE time >= now() - interval '1 day'
  ORDER BY time DESC
) TO STDOUT WITH CSV HEADER;
```

## Documentation

- [pgAdmin docs](https://www.pgadmin.org/)
- [PostgreSQL 16 docs](https://www.postgresql.org/docs/16/)
- [TimescaleDB docs](https://docs.timescale.com/)
