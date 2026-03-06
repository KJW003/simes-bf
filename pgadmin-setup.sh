#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# pgAdmin Server Setup Assistant
# Helps configure database servers in pgAdmin after deployment.
# Usage: chmod +x pgadmin-setup.sh && ./pgadmin-setup.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/infra/docker"
ENV_FILE="$COMPOSE_DIR/.env"

# Source .env
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           pgAdmin Server Configuration Helper                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
info "To add database servers to pgAdmin, follow these steps:"
echo ""
echo "1. Open your browser and go to:"
echo "   ${CYAN}http://localhost/pgadmin${NC}"
echo ""
echo "2. Login with:"
echo "   Email:    ${CYAN}${PGADMIN_EMAIL}${NC}"
echo "   Password: ${CYAN}${PGADMIN_PASSWORD}${NC}"
echo ""
echo "3. In the left sidebar, right-click 'Servers' → 'Register' → 'Server'"
echo ""
echo "4. Configure the FIRST server (Core DB):"
echo ""
echo "   NAME tab:"
echo "     Name: ${CYAN}SIMES Core${NC}"
echo ""
echo "   CONNECTION tab:"
echo "     Host name/address: ${CYAN}core-db${NC}"
echo "     Port: ${CYAN}5432${NC}"
echo "     Maintenance database: ${CYAN}${CORE_DB_NAME}${NC}"
echo "     Username: ${CYAN}${CORE_DB_USER}${NC}"
echo "     Password: ${CYAN}${CORE_DB_PASSWORD}${NC}"
echo "     Save password? ${CYAN}Yes${NC}"
echo ""
echo "   Then click 'Save'"
echo ""
echo "5. Configure the SECOND server (Telemetry DB):"
echo ""
echo "   NAME tab:"
echo "     Name: ${CYAN}SIMES Telemetry (TimescaleDB)${NC}"
echo ""
echo "   CONNECTION tab:"
echo "     Host name/address: ${CYAN}telemetry-db${NC}"
echo "     Port: ${CYAN}5432${NC}"
echo "     Maintenance database: ${CYAN}${TELEMETRY_DB_NAME}${NC}"
echo "     Username: ${CYAN}${TELEMETRY_DB_USER}${NC}"
echo "     Password: ${CYAN}${TELEMETRY_DB_PASSWORD}${NC}"
echo "     Save password? ${CYAN}Yes${NC}"
echo ""
echo "   Then click 'Save'"
echo ""
echo "═════════════════════════════════════════════════════════════════"
echo ""
ok "Once configured, you can:"
echo "  • Browse tables and schemas"
echo "  • Execute SQL queries (try the 'Query Tool')"
echo "  • Export/import data"
echo "  • Audit data quality and integrity"
echo ""
echo "Quick audit queries you can run:"
echo ""
echo "  SELECT COUNT(*) as total FROM acrel_readings;"
echo "  SELECT COUNT(DISTINCT point_id) as points FROM acrel_readings;"
echo "  SELECT MIN(time), MAX(time) FROM acrel_readings;"
echo "  SELECT * FROM acrel_readings LIMIT 10 ORDER BY time DESC;"
echo ""
echo "═════════════════════════════════════════════════════════════════"
echo ""
