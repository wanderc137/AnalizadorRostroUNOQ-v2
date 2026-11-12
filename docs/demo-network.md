# Red de demo — TP-Link TL-MR3420 + Arduino UNO Q + IP Webcam

> Runbook de la red local que se usa para demostrar la aplicación **sin depender de
> internet ni de la red del cliente**. Todo el tráfico queda dentro de un router
> dedicado: notebook, UNO Q y teléfono con IP Webcam.

---

## 1. Objetivo

Montar una red WiFi **aislada, portable y reproducible** para que en el cliente
alcance con:

1. Enchufar el router a 220 V.
2. Conectar el notebook por cable.
3. Encender la UNO Q.
4. Conectar el teléfono a la WiFi y abrir IP Webcam.

La aplicación queda en `http://192.168.10.75:8001` y la cámara en
`http://192.168.10.249:8080/video` (IP reservada).

### No requiere internet

La demostración es **100 % local**. Ningún componente consulta servicios externos:

| Componente | Funciona sin internet | Por qué |
|---|---|---|
| Router | Sí | Solo conmutación LAN + AP WiFi, sin WAN |
| UNO Q | Sí | Modelo ONNX/Caffe local, sin telemetría ni nube |
| App web | Sí | FastAPI + OpenCV en la placa; el navegador va por LAN |
| IP Webcam | Sí | Sirve el stream MJPEG desde el teléfono por WiFi local |
| Notebook | Sí | Solo abre el navegador contra `192.168.10.75` |

El único tráfico externo posible es el que el notebook haga por **otra** interfaz
(su WiFi de casa o datos móviles), y es ajeno a la demo.

---

## 2. Topología

```text
        ┌───────────────────────────────┐
        │ Notebook                      │
        │ enp0s31f6  192.168.10.165     │
        │ (DHCP)                        │
        └──────────────┬────────────────┘
                       │ cable Ethernet (LAN)
        ┌──────────────┴────────────────┐
        │ TP-Link TL-MR3420 v5          │
        │ OpenWrt 24.10.8               │
        │ LAN 192.168.10.1/24           │
        │ WiFi "DEMO-UNOQ" (2.4 GHz)    │
        │ WAN: sin conectar             │
        └───────┬───────────────┬───────┘
                │ WiFi          │ WiFi
     ┌──────────┴─────────┐  ┌──┴────────────────────┐
     │ Arduino UNO Q      │  │ Teléfono              │
     │ 192.168.10.75 fija │  │ reservada .249        │
     │ Puerto 8001        │  │ IP Webcam puerto 8080 │
     └────────────────────┘  └───────────────────────┘
```

---

## 3. Credenciales y direcciones

| Recurso | Valor |
|---|---|
| SSID | `DEMO-UNOQ` |
| Clave WiFi | `DemoUNOQ2026` (WPA2-PSK / CCMP) |
| Panel del router (LuCI) | <http://192.168.10.1> |
| Usuario del router | `root` |
| Clave del router | No se versiona en el repositorio; está en la nota interna del montaje |
| SSH a la UNO Q | `ssh -i ~/.ssh/unoq_key arduino@192.168.10.75` |
| App | <http://192.168.10.75:8001> |
| mDNS | <http://analizador-v2.local:8001> |
| Cámara | `http://192.168.10.249:8080/video` |

> La clave WiFi es de una red de demo aislada. Si el router se reutiliza para otra
> cosa, cambiala antes.

---

## 4. Router

| Ítem | Valor |
|---|---|
| Modelo | TP-Link TL-MR3420 v5 (MT7628, 2.4 GHz, ~58 MB RAM) |
| Firmware | OpenWrt 24.10.8 `r29233-443ec4032a` |
| LAN | `192.168.10.1/24` sobre `br-lan` |
| DHCP | `192.168.10.100` – `192.168.10.249` |
| WiFi | `DEMO-UNOQ`, `psk2`, canal 1, HT20 |
| WAN | sin conectar |

### Recrear la WiFi por SSH/UCI

```bash
ssh root@192.168.10.1

uci set wireless.@wifi-iface[0].ssid='DEMO-UNOQ'
uci set wireless.@wifi-iface[0].key='DemoUNOQ2026'
uci set wireless.@wifi-iface[0].encryption='psk2'
uci commit wireless
wifi reload
```

Verificación:

```bash
iwinfo phy0-ap0 info | grep -E "ESSID|Encryption"
iwinfo phy0-ap0 assoclist
```

### Reserva DHCP del teléfono

El teléfono tiene **IP reservada** (aplicada en este montaje, con su MAC de
fábrica):

| Campo | Valor |
|---|---|
| Nombre | `celular-ipwebcam` |
| MAC | `24:da:33:90:95:b5` |
| IP | `192.168.10.249` |

La receta UCI equivalente:

```bash
uci add dhcp host
uci set dhcp.@host[-1].name='celular-ipwebcam'
uci set dhcp.@host[-1].mac='24:da:33:90:95:b5'
uci set dhcp.@host[-1].ip='192.168.10.249'
uci commit dhcp
/etc/init.d/dnsmasq restart
```

> La `.249` queda al tope del pool dinámico (`.100`–`.249`), pero la reserva la
> fija: `dnsmasq` no se la entrega a otro equipo. La `.75` (UNO Q) es estática
> manual, fuera del pool.
>
> **Estabilidad**: el teléfono debe usar **"MAC del dispositivo"** (no aleatoria)
> en esta red y **no "olvidarla"**, o al reconectarse podría generar otra MAC y
> perder la reserva.

---

## 5. UNO Q

| Ítem | Valor |
|---|---|
| Hostname | `analizador-v2` |
| Perfil NetworkManager | `DEMO-UNOQ` |
| Interfaz | `wlan0` |
| IP | `192.168.10.75/24` (manual) |
| Gateway / DNS | `192.168.10.1` |
| `autoconnect` | `yes`, prioridad 20 |
| Servicio | `unoq-app-v2` (`enabled`, puerto 8001) |
| Directorio | `/home/arduino/AnalizadorRostroUNOQ-v2` |

El perfil se crea con [`scripts/demo-profile.sh`](../scripts/demo-profile.sh), que:

1. Crea/actualiza el perfil `DEMO-UNOQ` con IP fija.
2. Lo activa.
3. Si en 20 s no hay IP o no responde el gateway, **revierte** al perfil de la red
   de casa (`INNOVAPRO STARLINK 2.4 Ghz`).

Se ejecuta como root. En la placa no hay clave de sudo interactiva disponible para
automatización, así que se usó un contenedor local con `chroot` al host:

```bash
docker run --rm --privileged --net=host --pid=host -v /:/host \
  influxdb:2.7 chroot /host /bin/bash /home/arduino/.unoq-demo-profile.sh
```

Comprobación:

```bash
nmcli -t -f NAME,DEVICE,STATE connection show --active
ip -4 -br addr show wlan0
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8001/healthz
```

### Servicios y arranque (todo automático)

Al darle corriente a la UNO Q todo arranca solo, sin intervención manual:

| Componente | Servicio / mecanismo | Arranque |
|---|---|---|
| App v2 (puerto 8001) | `unoq-app-v2.service` | `enabled` (boot) |
| Cámara | hilo interno con reintento cada 2 s | automático |
| WiFi `DEMO-UNOQ` | perfil NM `autoconnect=yes`, prioridad 20 | automático |
| IP fija `.75` | perfil `DEMO-UNOQ` manual | automático |
| mDNS `analizador-v2.local` | `avahi-daemon` | `enabled` |

El hilo de cámara reintenta la fuente cada 2 s: **no importa el orden** de
encendido entre placa y teléfono.

> En la placa hay **dos apps**: la **v1** (`unoq-app.service`, puerto **8000**,
> muestra "Pipeline detenido") y la **v2** (`unoq-app-v2.service`, puerto **8001**,
> la de esta demo). Abrir siempre el **8001**.

---

## 6. Notebook

| Ítem | Valor |
|---|---|
| Perfil NetworkManager | `DEMO-UNOQ-CABLE` |
| Interfaz | `enp0s31f6` |
| IPv4 | DHCP (`192.168.10.165` en la última prueba) |
| `autoconnect` | `yes`, prioridad 100 |
| IPv6 | `ignore` |

Al enchufar el cable, el perfil se activa solo. Para recrearlo:

```bash
nmcli connection add type ethernet con-name DEMO-UNOQ-CABLE ifname enp0s31f6
nmcli connection modify DEMO-UNOQ-CABLE ipv4.method auto ipv6.method ignore \
  connection.autoconnect yes connection.autoconnect-priority 100
nmcli connection up DEMO-UNOQ-CABLE
```

> Si el notebook mantiene otra conexión (WiFi de casa), **no pierde internet**: la
> ruta por defecto sigue saliendo por la interfaz con menor métrica. El tráfico a
> `192.168.10.0/24` va por el cable.

---

## 7. Teléfono (IP Webcam)

1. WiFi → `DEMO-UNOQ` → clave `DemoUNOQ2026`.
2. Si Android avisa que la red no tiene internet → **Mantener conexión**.
3. Desactivar el **cambio automático a datos móviles** y la **conmutación
   automática a la mejor red** (Android salta a la red de casa porque tiene
   internet y la demo no; si vuelve a escaparse, "olvidar" la otra red).
4. Usar **MAC del dispositivo** (no aleatoria) para que la reserva DHCP sea estable.
5. Abrir **IP Webcam** → **Iniciar servidor**.
6. Dejar la app en primer plano y la pantalla encendida.

En la placa, actualizar la URL de la cámara y reiniciar:

```bash
grep -n CAMERA_SOURCE /home/arduino/AnalizadorRostroUNOQ-v2/.env
# CAMERA_SOURCE=http://192.168.10.249:8080/video
sudo systemctl restart unoq-app-v2
```

---

## 8. Secuencia en el cliente

> **Importante**: el router tarda **~2–3 min** en levantar el WiFi tras darle
> corriente. Encender la UNO Q **después** de que el LED de WiFi quede estable; si
> arranca antes, se conecta a otra red (p. ej. la de casa) y no vuelve sola
> (ver §10).

1. Enchufar el router a 220 V y esperar **~3 min** (LED de WiFi estable).
2. Conectar el cable del notebook a un puerto **LAN** (no WAN).
3. Encender la UNO Q (arranca `unoq-app-v2` sola).
4. Conectar el teléfono a `DEMO-UNOQ`.
5. Abrir IP Webcam y pulsar **Iniciar servidor**.
6. Abrir `http://192.168.10.75:8001` en el notebook.

---

## 9. Verificación rápida

| Qué | Comando | Esperado |
|---|---|---|
| Router alcanzable | `ping -c2 192.168.10.1` | responde |
| UNO Q alcanzable | `ping -c2 192.168.10.75` | responde |
| App viva | `curl -s http://192.168.10.75:8001/healthz` | `{"status":"ok"...}` |
| Estado | `curl -s http://192.168.10.75:8001/api/status` | `camera.online: true` |
| Cámara responde | `curl -sI http://192.168.10.249:8080/video` | `200` / `multipart` |
| mDNS | `getent hosts analizador-v2.local` | `192.168.10.75` |

---

## 10. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| La UNO Q no aparece en `assoclist` | No arrancó el perfil o el SSID no coincide | `nmcli connection up DEMO-UNOQ` |
| La UNO Q quedó en `192.168.1.x` (no en `.10.x`) | El router aún no había levantado el WiFi al bootear la placa | `nmcli connection up DEMO-UNOQ`; o encender el router y esperar ~3 min antes de la placa |
| La UNO Q está asociada pero sin IP | Perfil manual con IP fuera de subred | Verificar `ipv4.addresses` |
| El teléfono se conecta y se cae | Android vuelve a datos móviles | "Mantener conexión" + desactivar cambio automático |
| La app dice `camera: offline` | `CAMERA_SOURCE` con IP vieja | Actualizar `.env` y reiniciar el servicio |
| `analizador-v2.local` no resuelve | mDNS bloqueado o caché | `resolvectl flush-caches`; usar la IP |
| El notebook queda sin internet | Se conectó el WAN del router a la red del cliente | Desconectar el WAN (la demo es LAN) |

---

## 11. Seguridad y alcance

- La red **no tiene salida a internet** (WAN desconectada): es una LAN cerrada.
- El panel del router no se publica fuera de `192.168.10.0/24`.
- La clave WiFi quedó documentada porque es una red de demo; **no reutilizar** este
  router con esa clave en un entorno real.
- La app no guarda imágenes por defecto (`snapshots` deshabilitado).
- El `.env` real no se versiona; solo `.env.example`.
