#!/bin/bash
# set_static_ip.sh — Fija la IP de la UNO Q en la red WiFi (NetworkManager).
# Ejecutar como ROOT (sudo). Hace copia de respaldo del perfil y revierte a DHCP
# automaticamente si la configuracion no queda operativa.
#
# Uso:  sudo bash scripts/set_static_ip.sh [IP] [GATEWAY]
#   scripts/set_static_ip.sh                -> perfil DEMO-UNOQ, 192.168.10.75
#   scripts/set_static_ip.sh 192.168.10.90  -> otra IP en la misma red
#   CONN="INNOVAPRO STARLINK 2.4 Ghz" IP=192.168.1.75 GW=192.168.1.1 \
#     sudo -E bash scripts/set_static_ip.sh
set -u

CONN="${CONN:-DEMO-UNOQ}"
DEV="wlan0"
IP="${1:-192.168.10.75}"
PREFIX="${PREFIX:-24}"
GW="${2:-192.168.10.1}"
DNS1="${DNS1:-192.168.10.1}"
DNS2="${DNS2:-1.1.1.1}"

log() { echo "[$(date +%H:%M:%S)] $*"; }

if [ "$(id -u)" -ne 0 ]; then
	echo "ERROR: ejecutar como root (sudo bash $0)" >&2
	exit 1
fi

BK="/var/backups/nm/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK" 2>/dev/null
if [ -f "/etc/NetworkManager/system-connections/$CONN.nmconnection" ]; then
	cp -a "/etc/NetworkManager/system-connections/$CONN.nmconnection" "$BK/" 2>/dev/null \
		&& log "Respaldo del perfil: $BK"
fi

log "Aplicando IP fija ${IP}/${PREFIX} gw ${GW} dns ${DNS1},${DNS2} en '$CONN'"
if ! nmcli connection modify "$CONN" \
	ipv4.method manual \
	ipv4.addresses "${IP}/${PREFIX}" \
	ipv4.gateway "$GW" \
	ipv4.dns "$DNS1 $DNS2" \
	ipv4.ignore-auto-dns yes; then
	log "ERROR: nmcli connection modify fallo"
	exit 1
fi

# Reaplicar en caliente (sin cortar el enlace si es posible).
nmcli device reapply "$DEV" >/dev/null 2>&1 || {
	log "reapply no disponible, reactivando la conexion..."
	nmcli connection up "$CONN" >/dev/null 2>&1
}

sleep 12

OK=1
ip -4 addr show "$DEV" 2>/dev/null | grep -q "inet ${IP}/" || {
	log "ERROR: ${IP} no esta configurada en ${DEV}"
	OK=0
}
ip route 2>/dev/null | grep -q "default via ${GW} dev ${DEV}" || {
	log "ERROR: no hay ruta default via ${GW} por ${DEV}"
	OK=0
}

if [ "$OK" -eq 1 ]; then
	if ping -c 2 -W 2 "$GW" >/dev/null 2>&1; then
		log "Gateway ${GW} responde"
	else
		log "AVISO: gateway ${GW} no responde a ping (puede estar filtrado)"
	fi
	if getent hosts dns.google >/dev/null 2>&1; then
		log "DNS operativo"
	else
		log "AVISO: resolucion DNS fallida — revisar ${DNS1}/${DNS2}"
	fi
	log "OK: IP fija activa."
	nmcli -f ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns connection show "$CONN"
	exit 0
fi

log "ROLLBACK: restaurando DHCP en '$CONN'"
nmcli connection modify "$CONN" \
	ipv4.method auto \
	ipv4.addresses "" \
	ipv4.gateway "" \
	ipv4.dns "" \
	ipv4.ignore-auto-dns no >/dev/null 2>&1
nmcli connection up "$CONN" >/dev/null 2>&1 || nmcli device reapply "$DEV" >/dev/null 2>&1
sleep 6
nmcli -f ipv4.method,ipv4.addresses connection show "$CONN"
exit 1
