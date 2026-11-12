#!/bin/bash
# demo-profile.sh — crea y activa el perfil WiFi de la red DEMO-UNOQ en la UNO Q.
# Pensado para ejecutarse como root (via contenedor con chroot al host).
# Si la red demo no queda operativa, revierte al perfil INNOVAPRO.
set -u

DEMO_CONN="DEMO-UNOQ"
DEMO_SSID="DEMO-UNOQ"
DEMO_PSK="DemoUNOQ2026"
DEMO_IP="192.168.10.75/24"
DEMO_GW="192.168.10.1"
FALLBACK_CONN="INNOVAPRO STARLINK 2.4 Ghz"
DEV="wlan0"

log() { echo "[$(date +%H:%M:%S)] $*"; }

log "Creando/actualizando perfil '$DEMO_CONN'"
nmcli connection show "$DEMO_CONN" >/dev/null 2>&1 && nmcli connection delete "$DEMO_CONN" >/dev/null 2>&1

nmcli connection add type wifi con-name "$DEMO_CONN" ifname "$DEV" ssid "$DEMO_SSID" || {
	log "ERROR: no se pudo crear el perfil"
	exit 1
}

nmcli connection modify "$DEMO_CONN" \
	wifi-sec.key-mgmt wpa-psk \
	wifi-sec.psk "$DEMO_PSK" \
	ipv4.method manual \
	ipv4.addresses "$DEMO_IP" \
	ipv4.gateway "$DEMO_GW" \
	ipv4.dns "$DEMO_GW" \
	ipv4.ignore-auto-dns yes \
	connection.autoconnect yes \
	connection.autoconnect-priority 20 || {
	log "ERROR: no se pudo configurar el perfil"
	exit 1
}

log "Activando '$DEMO_CONN' (la sesion SSH actual se va a cortar)"
nmcli connection up "$DEMO_CONN" || log "AVISO: 'con up' devolvio error"

sleep 20

OK=1
ip -4 addr show "$DEV" 2>/dev/null | grep -q "inet 192.168.10.75/" || {
	log "ERROR: 192.168.10.75 no esta en $DEV"
	OK=0
}
ping -c 2 -W 2 "$DEMO_GW" >/dev/null 2>&1 || {
	log "ERROR: gateway $DEMO_GW no responde"
	OK=0
}

if [ "$OK" -eq 1 ]; then
	log "OK: conectada a $DEMO_SSID con IP fija 192.168.10.75"
	nmcli -f GENERAL.STATE,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS device show "$DEV"
	nmcli -f connection.autoconnect,connection.autoconnect-priority,ipv4.method connection show "$DEMO_CONN"
	exit 0
fi

log "ROLLBACK: volviendo a '$FALLBACK_CONN'"
nmcli connection up "$FALLBACK_CONN" >/dev/null 2>&1
exit 1
