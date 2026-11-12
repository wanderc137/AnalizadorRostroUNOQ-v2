# AnalizadorRostroUNOQ v2 — Manual del usuario

**Versión documentada:** 2.0.0 · **Plataforma:** Arduino UNO Q, MPU Linux (Qualcomm QRB2210, ARM64, Debian) · **Última revisión:** 2026

Este documento es el **manual de usuario** de la aplicación. Explica qué hace, cómo se instala, cómo se opera, cómo se interpretan sus resultados y qué límites tiene. Para la arquitectura interna y la guía de modificación del código, ver [`developer.md`](developer.md). Para el proceso de desarrollo y las decisiones, ver [`BITACORA.md`](BITACORA.md).

---

## Tabla de contenidos

1. [Qué es y para qué sirve](#1-qué-es-y-para-qué-sirve)
2. [Principio de funcionamiento](#2-principio-de-funcionamiento)
3. [Especificaciones técnicas](#3-especificaciones-técnicas)
4. [Instalación](#4-instalación)
5. [Puesta en marcha](#5-puesta-en-marcha)
6. [Operación de la interfaz](#6-operación-de-la-interfaz)
7. [Interpretación de los resultados](#7-interpretación-de-los-resultados)
8. [Estados y mensajes](#8-estados-y-mensajes)
9. [Configuración](#9-configuración)
10. [API HTTP para integradores](#10-api-http-para-integradores)
11. [Rendimiento y calibración](#11-rendimiento-y-calibración)
12. [Privacidad y datos biométricos](#12-privacidad-y-datos-biométricos)
13. [Mantenimiento](#13-mantenimiento)
14. [Solución de problemas](#14-solución-de-problemas)
15. [Preguntas frecuentes](#15-preguntas-frecuentes)
16. [Compatibilidad](#16-compatibilidad)
17. [Advertencias de seguridad](#17-advertencias-de-seguridad)
18. [Soporte y documentación](#18-soporte-y-documentación)
19. [Glosario](#19-glosario)

---

## 1. Qué es y para qué sirve

AnalizadorRostroUNOQ v2 es una **aplicación web local** que detecta rostros en un vídeo y estima, para cada uno, **género binario** y **rango de edad**. Corre íntegramente en el **MPU Linux** de la Arduino UNO Q y sirve la interfaz y el vídeo anotado a cualquier navegador de la red local.

### Uso previsto

- Demostraciones educativas y de portfolio sobre visión artificial embebida.
- Ferias, aulas y talleres donde se quiere mostrar **inferencia local sin nube**.
- Base para experimentar con detección, tracking, clasificación y streaming MJPEG.
- Comparación de dos backends (ONNX propio vs Caffe clásico) en el mismo hardware.

### Uso NO previsto

| Uso | Por qué no |
|---|---|
| Control de acceso o desbloqueo | No identifica personas; no hay verificación 1:1 ni anti-spoofing. |
| Vigilancia o seguimiento de individuos | No hay reconocimiento facial ni embeddings de identidad. |
| Determinar la edad legal | Es un rango estimado, no una medición; el error es alto. |
| Diagnóstico médico o psicológico | No es un instrumento clínico. |
| Perfilado publicitario real | El anuncio contextual es una demo local, sin historial ni envío de datos. |
| Uso con menores | Requiere base legal y salvaguardas específicas que este proyecto no implementa. |

> **Salida esperada:** una página en `http://<IP_DE_LA_PLACA>:8001/` con el vídeo en vivo, cajas sobre los rostros y etiquetas del tipo `Femenino | 20-29 (84%)`, un contador de rostros y FPS. La estimación es **estadística y no vinculante**.

---

## 2. Principio de funcionamiento

El sistema tiene cinco piezas que corren en el MPU:

1. **Captura.** Un hilo dedicado abre la cámara con OpenCV (`VideoCapture`). Si la fuente es una URL (`http(s)://`, `rtsp://`, `rtmp://`) usa FFmpeg; si es USB usa V4L2 (`/dev/videoN`). Mantiene siempre el último frame en memoria y se reconecta solo si la fuente falla.
2. **Detección.** Un único worker toma el frame y, cada `DETECT_EVERY_N` frames, ejecuta **YuNet** sobre una copia reducida a `YUNET_INPUT_WIDTH` (320 px). YuNet devuelve cajas y scores; las cajas se escalan a la resolución original. Si YuNet no está disponible, cae a **Haar cascade**.
3. **Tracker IoU.** Las cajas se asocian con las del frame anterior por **intersección sobre unión** (IoU). Si el solapamiento supera `TRACK_IOU_THRESHOLD`, se conserva la predicción anterior y solo se actualiza la caja; si no, se crea un track nuevo sin predicción. Esto estabiliza las etiquetas y evita reclasificar cada frame.
4. **Clasificación.** Cada `INFER_EVERY_N` frames —o si alguna cara aún no tiene etiqueta— se recorta la cara con un margen del 6 % y se pasa al backend activo: **ONNX UTKFace** (224×224, propio) o **Caffe Levi & Hassner** (227×227, fallback). Devuelve género y uno de los 8 buckets de edad, con confianza.
5. **Publicación.** El frame se anota (cajas, etiquetas, HUD) y se codifica a JPEG. FastAPI lo sirve como **stream MJPEG** a todos los clientes. Los clientes no ejecutan inferencia: solo reciben el mismo JPEG.

```text
Cámara IP/USB
     │  frame BGR
     ▼
Camera thread ──► último frame (lock)
     │
     ▼
VideoPipeline (1 worker)
     ├─ cada DETECT_EVERY_N ─► YuNet 320 px ─► cajas
     ├─ tracker IoU ─► cajas estables + predicciones conservadas
     ├─ cada INFER_EVERY_N ─► ONNX/Caffe ─► género + edad
     ├─ overlay ─► JPEG
     └─ publica bajo lock ─► GET /video (MJPEG) ─► navegador
```

Diagramas vectoriales: [`assets/architecture.svg`](assets/architecture.svg) y [`assets/pipeline.svg`](assets/pipeline.svg).

### Modos de operación

| Modo | Condición | Qué se ve |
|---|---|---|
| **Normal** | Cámara + modelo + al menos un cliente MJPEG | Vídeo anotado, etiquetas completas, FPS. |
| **Degradado** | Cámara OK, pero ningún modelo cargado | Cajas ámbar y texto `Rostro detectado \| modelo no cargado`. |
| **Sin cámara** | Fuente ausente o caída | Placeholder 640×480 con `CAMARA NO DISPONIBLE`; el worker sigue vivo. |
| **Idle** | 0 clientes MJPEG | No se infiere ni se codifica; solo se lee la cámara cada 250 ms. |

---

## 3. Especificaciones técnicas

### 3.1 Hardware

| Elemento | Especificación |
|---|---|
| Placa | Arduino UNO Q |
| MPU | Qualcomm QRB2210, **ARM64**, Linux Debian |
| RAM reportada | 8 GB (suficiente para el runtime; el modelo ONNX pesa ~10 MB) |
| MCU | STM32U585 con Zephyr — **no se usa** en esta aplicación |
| Cámara recomendada | Teléfono con **IP Webcam** (MJPEG por WiFi) o cámara IP compatible |
| Cámara USB | Logitech Brio u otra UVC; requiere **host mode** (hub USB-C con PD o VIN + JCTL) |
| Dispositivo USB | `/dev/video0` (o el índice que corresponda) |
| Red | WiFi 2,4 GHz o Ethernet; la demo usa una LAN aislada |
| Alimentación | Fuente oficial de la UNO Q; la Brio no debe colgar de un puerto débil |

> La UNO Q **no alimenta correctamente una Brio por el puerto USB-C de usuario** en todos los modos. Si la cámara aparece y desaparece, es un problema eléctrico antes que de software.

### 3.2 Software

| Componente | Versión / nota |
|---|---|
| Sistema operativo | Debian del MPU (ARM64) |
| Python | **3.10+** (NumPy 2.2 lo exige) |
| FastAPI | `>=0.115.0,<0.116` |
| Uvicorn | `>=0.30.0,<0.31` |
| OpenCV | `opencv-python-headless >=4.12.0,<5` |
| NumPy | `>=2.2.0,<3` |
| Pillow | `>=11.0.0,<13` |
| python-dotenv | `>=1.0.0,<2.0` |
| python-multipart | `>=0.0.9,<0.1` |

Las versiones exactas están en [`../requirements.txt`](../requirements.txt). No se usa `opencv-python` completo porque la placa no tiene servidor gráfico; `headless` evita dependencias de GUI.

### 3.3 Modelos

| Backend | Archivo | Entrada | Salidas | Licencia / origen |
|---|---|---|---|---|
| Detección YuNet | `models/face_detection_yunet_2023mar.onnx` (~228 KB) | 320×320 (configurable) | cajas + score | MIT, OpenCV Zoo |
| Detección Haar | incluido en OpenCV | gris, escala | cajas | Apache 2.0, Viola-Jones |
| Clasificación ONNX | `models/utkface_mobilenetv2.onnx` (~10,2 MB) | 224×224, RGB, `x/127.5−1`, NCHW | género (1), edad (8) | Entrenado con UTKFace |
| Clasificación Caffe | `models/fallback/*.caffemodel` (~88 MB) | 227×227, BGR, media fija | género (2), edad (8) | Levi & Hassner / smahesh29 |
| Sin modelo | — | — | — | Modo degradado |

**Contrato ONNX:** entrada `[N, 3, 224, 224]` float32; salida `gender` con sigmoide (0 = masculino, 1 = femenino) y `age` con softmax de 8 clases en el orden de `AGE_BUCKETS`.

**Contrato Caffe:** entrada `[N, 3, 227, 227]`; `gender_net` 2 clases y `age_net` 8 clases con buckets **fijos** (`0-2, 4-6, 8-12, 15-20, 25-32, 38-43, 48-53, 60-100`). No usa `AGE_BUCKETS`.

### 3.4 Servicio

| Parámetro | Valor por defecto |
|---|---|
| Bind | `0.0.0.0` |
| Puerto | `8001/tcp` |
| Stream | `multipart/x-mixed-replace; boundary=frame` |
| Resolución de trabajo | 640×480 (máximo; se conserva el aspecto) |
| FPS objetivo | 15 |
| Detección | cada 2 frames, YuNet a 320 px |
| Clasificación | cada 5 frames, solo caras sin predicción |
| Umbral de confianza | 0.6 |
| Calidad JPEG | 80 |
| Workers | **1** (obligatorio) |

---

## 4. Instalación

### 4.1 Requisitos previos

En la placa:

```bash
python3 --version          # 3.10 o superior
sudo apt-get update        # solo si falta python3-venv; requiere autorización
sudo apt-get install -y python3-venv python3-pip
```

En el host de desarrollo (solo para desplegar): `adb`, `ssh`, `rsync`, `curl` y un navegador.

### 4.2 Dependencias de Python (entorno virtual)

Las dependencias están en **`requirements.txt`**. Creá un entorno virtual **siempre**; no instales en el Python del sistema:

```bash
cd AnalizadorRostroUNOQ-v2
python3 -m venv venv
source venv/bin/activate        # Linux / macOS
venv\Scripts\activate           # Windows (cmd)
pip install -r requirements.txt
```

Verificación rápida:

```bash
python -c "import cv2, numpy, fastapi, uvicorn; print(cv2.__version__, numpy.__version__)"
```

> En la placa, los scripts crean `.venv` (con punto) en la raíz del proyecto. En un PC podés usar `venv` o `.venv`; lo importante es activarlo antes de `pip install` y de ejecutar la app.

### 4.3 Modelos

**Opción A — fallback Caffe (rápida):**

```bash
bash scripts/download_fallback_models.sh
ls -lh models/fallback/
# age_net.caffemodel (~45,7 MB), gender_net.caffemodel (~45,6 MB), 2 prototxt
```

**Opción B — ONNX UTKFace (recomendada):**

```bash
# El release es privado: requiere gh autenticado con acceso al repo
gh release download v1.0.0 --repo wanderc137/AnalizadorRostroUNOQ \
  --pattern utkface_mobilenetv2.onnx --dir models

# o, si el script está configurado:
bash scripts/download_model.sh
```

El modelo también se puede entrenar y copiar (ver [`../training/README.md`](../training/README.md)).

### 4.4 Verificación de la instalación

```bash
python -m compileall app python training
bash -n scripts/*.sh
node --check static/app.js          # si tenés Node; opcional
python training/train_utkface.py --self-test   # 9/9
```

Si todo pasa, arrancá la app:

```bash
python -m app.main
# o
./scripts/run.sh
```

Y abrí `http://127.0.0.1:8001/`.

---

## 5. Puesta en marcha

### 5.1 En la placa, con despliegue automático

```bash
# Por USB/ADB
./scripts/deploy_unoq.sh --adb --setup --model

# Por SSH
UNOQ_HOST=192.168.10.75 UNOQ_USER=arduino \
  ./scripts/deploy_unoq.sh --ssh --setup --model
```

El script copia el proyecto a `/home/arduino/ArduinoApps/AnalizadorRostroUNOQ`, crea el `.venv`, instala dependencias y (con `--model`) descarga el ONNX. **No copia `.env`**: la configuración se crea en la placa a partir de `.env.example`.

### 5.2 Servicio systemd

```bash
sudo systemctl status unoq-app-v2
sudo systemctl restart unoq-app-v2
sudo journalctl -u unoq-app-v2 -f
```

El servicio queda `enabled` y arranca con la placa. Los scripts `~/start-server.sh` y `~/stop-server.sh` son atajos.

### 5.3 Cámara IP Webcam

1. Instalá **IP Webcam** en el teléfono y conectalo a la misma red que la placa.
2. Iniciá el servidor; la app muestra la URL (`http://IP:8080`).
3. Configurá en la placa:

```bash
CAMERA_SOURCE=http://192.168.10.249:8080/video
```

4. Reiniciá el servicio. El primer frame puede tardar 2–4 s.

> Mantené IP Webcam en primer plano y la pantalla encendida. Si el teléfono cambia de red o entra en reposo, el stream se corta y la app muestra la cámara offline; se reconecta sola cada 2 s cuando la fuente vuelve.

### 5.4 Cámara USB (Brio)

```bash
lsusb
ls -l /dev/video*
```

Si aparece `/dev/video0`, dejá `CAMERA_SOURCE` vacío y `CAMERA_INDEX=0`. Si aparece otro índice, ajustalo. Para permisos:

```bash
sudo usermod -aG video "$USER"
# cerrar sesión y volver a entrar
```

> El hub USB-C debe soportar **Power Delivery** y modo host. Un hub pasivo no alcanza. Alternativa: alimentar por VIN (7–24 V) y usar el puente JCTL.

### 5.5 Secuencia típica de demo

1. Encender el router y esperar 2–3 minutos (si usás la red de demo).
2. Conectar el notebook por cable LAN.
3. Encender la UNO Q y esperar el arranque de Linux.
4. Conectar el teléfono a la WiFi de demo e iniciar IP Webcam.
5. Abrir `http://192.168.10.75:8001/`.
6. Pulsar **Iniciar cámara** si no está activa.

Detalle completo de la red: [`demo-network.md`](demo-network.md).

---

## 6. Operación de la interfaz

### 6.1 Controles

| Control | Acción |
|---|---|
| **Iniciar cámara** | `POST /api/camera/start`. Reinicia la captura y espera hasta 8 s un frame válido. |
| **Detener** | `POST /api/camera/stop`. Libera la cámara; el pipeline queda vivo. |
| **Snapshot** | `POST /api/snapshot`. Guarda un JPEG en `SNAP_FOLDER` si está configurado y habilitado. |
| **Token API** | Campo local para enviar `X-Api-Token` en las peticiones POST. No se guarda en el servidor. |

### 6.2 Indicadores

- **Badge de cámara:** `Cámara OK` / `Cámara offline`.
- **Badge de backend:** `ONNX`, `Caffe` o `Sin modelo`.
- **Badge de FPS:** FPS suavizado del pipeline.
- **Panel Estado del sistema:** cámara, backend, detector, modelo, resolución, clasificación, FPS, mensaje y timings.
- **Vista en vivo:** stream MJPEG con HUD `Rostros: N | FPS: x.x`.
- **Anuncio contextual:** tarjeta de demostración que cambia según la estimación; no es publicidad real.

### 6.3 Flujo de uso recomendado

1. Verificá que la cámara esté OK y el backend cargado.
2. Colocá una persona a 0,5–2 m, con luz frontal difusa.
3. Esperá 2–3 frames a que el tracker estabilice la etiqueta.
4. Leé el resultado como **estimación**, no como verdad.
5. Si la etiqueta muestra `~` y `?`, la confianza fue baja: no la uses para ninguna decisión.

---

## 7. Interpretación de los resultados

### 7.1 Etiquetas

| Etiqueta | Significado |
|---|---|
| `Masculino \| 20-29 (87%)` | Género estimado, bucket de edad y confianza media. |
| `~Femenino? \| 30-39 (54%)` | Alguna cabeza no superó `CONF_THRESHOLD`; el `~` y el `?` indican baja confianza. |
| `Rostro detectado \| modelo no cargado` | Modo degradado: hay detección, no clasificación. |
| Caja **teal** | Rostro con predicción. |
| Caja **ámbar** | Rostro sin predicción o con modelo ausente. |
| `CAMARA OFFLINE` | No hay frames frescos (< 3 s). |

El porcentaje es el **promedio** de la confianza de género y de edad, redondeado. No es una probabilidad calibrada de que la persona tenga esa edad: es la confianza interna del modelo en su propia clasificación.

### 7.2 Qué significa el género

El modelo fue entrenado con etiquetas binarias de UTKFace. Devuelve `Masculino` o `Femenino` según esa categoría aprendida. **No infiere identidad de género** y no representa personas no binarias. Es una limitación del dataset y del modelo, no una afirmación sobre la persona.

### 7.3 Qué significa el rango de edad

Ocho buckets: `0-2`, `3-9`, `10-19`, `20-29`, `30-39`, `40-49`, `50-59`, `60+`. Son rangos gruesos, pensados para una demo. La métrica de edad exacta del modelo es **48,17 %** en test; el acierto dentro de **±1 bucket** es **83,8 %**. Eso significa que, en la práctica, el bucket vecino suele ser plausible. No es edad exacta.

### 7.4 Anuncio contextual

La demo elige un creativo local según género y banda de edad:

| Género estimado | Banda | Creativo |
|---|---|---|
| Masculino | < 20 | Teléfono |
| Masculino | 20–40 | Computador |
| Masculino | > 40 | Corbatas |
| Femenino | < 20 | Teléfono |
| Femenino | 20–40 | Pañuelo |
| Femenino | > 40 | Auto |
| Sin rostro / baja confianza | — | Viajes |

Bandas por punto medio del bucket (`20-29` → 24.5). Umbrales: `gender_confidence >= 0.55` y `age_confidence >= 0.25`. Los textos, precios y marcas son **ficticios**. No hay historial ni perfil: el creativo se decide en memoria con el frame actual.

---

## 8. Estados y mensajes

### 8.1 Mensajes del pipeline

| Mensaje | Causa | Qué hacer |
|---|---|---|
| `OK` | Todo operativo. | — |
| `Modelo no cargado: modo solo detección` | Faltan archivos o falló la carga. | Revisar `model_error`, descargar modelos. |
| `Cámara no disponible` | Fuente ausente o sin frames. | Revisar `camera_error`, conexión, URL. |
| `Cámara detenida` | `stop()` explícito o caída. | Pulsar Iniciar cámara. |
| `Pipeline detenido` | Worker no arrancado. | Reiniciar el servicio. |
| `Pipeline detenido inesperadamente` | El hilo murió. | Revisar logs; reiniciar. |
| `Detector no disponible` | No se pudo crear YuNet ni Haar. | Revisar instalación de OpenCV. |

### 8.2 Códigos HTTP

| Código | Cuándo |
|---|---|
| `200` | Operación correcta. |
| `400` | `SNAP_FOLDER` inválido o fuera del proyecto. |
| `401` | Falta o no coincide `X-Api-Token`. |
| `429` | Snapshot antes de `SNAPSHOT_MIN_INTERVAL` (incluye `Retry-After`). |
| `500` | Error de escritura del snapshot. |
| `503` | Cámara no abre en 8 s; snapshot deshabilitado o sin frame. |

---

## 9. Configuración

Toda la configuración se lee de `.env` (o del entorno). El archivo `.env.example` es la plantilla; **no se versiona `.env`**.

### 9.1 Variables principales

| Variable | Default | Descripción |
|---|---|---|
| `CAMERA_SOURCE` | vacío | URL MJPEG/RTSP/RTMP. Si está vacío, usa `CAMERA_INDEX`. |
| `CAMERA_INDEX` | `0` | Índice de cámara USB (`/dev/videoN`). |
| `WIDTH` / `HEIGHT` | `640` / `480` | Resolución de trabajo (máximo; conserva aspecto). |
| `FPS_TARGET` | `15` | Ritmo objetivo de captura. |
| `HOST` / `PORT` | `0.0.0.0` / `8001` | Bind del servidor. |
| `MODEL_BACKEND` | `auto` | `auto`, `utkface_onnx`, `caffe`. |
| `DETECTOR_BACKEND` | `auto` | `auto`, `yunet`, `haar`. |
| `YUNET_MODEL` | `models/face_detection_yunet_2023mar.onnx` | Ruta del detector. |
| `YUNET_SCORE_THRESHOLD` | `0.6` | Score mínimo de YuNet. |
| `YUNET_NMS_THRESHOLD` | `0.3` | NMS de YuNet. |
| `YUNET_INPUT_WIDTH` | `320` | Ancho de entrada reducido. |
| `DETECT_EVERY_N` | `2` | Cada cuántos frames se detecta. |
| `TRACK_IOU_THRESHOLD` | `0.3` | IoU mínimo para asociar. |
| `TRACK_MAX_MISSES` | `2` | Frames que se conserva un track perdido. |
| `INFER_EVERY_N` | `5` | Cada cuántos frames se clasifica. |
| `CONF_THRESHOLD` | `0.6` | Umbral para marcar baja confianza. |
| `UTKFACE_ONNX_PATH` | `models/utkface_mobilenetv2.onnx` | Ruta del ONNX. |
| `CAFFE_*` | rutas en `models/fallback/` | Prototxt y pesos. |
| `AGE_BUCKETS` | 8 buckets UTKFace | Solo backend ONNX. |
| `JPEG_QUALITY` | `80` | Calidad del stream (30–95). |
| `SNAP_FOLDER` | vacío (deshabilitado) | Carpeta de snapshots dentro del proyecto. |
| `SNAPSHOT_MIN_INTERVAL` | `2.0` | Segundos mínimos entre snapshots. |
| `API_TOKEN` | vacío | Si se define, protege los POST. |

### 9.2 Reglas de validación

- `MODEL_BACKEND` y `DETECTOR_BACKEND` deben ser valores válidos; si no, se usa `auto` y se registra un warning.
- `DETECT_EVERY_N` e `INFER_EVERY_N` se fuerzan a `>= 1`.
- `CONF_THRESHOLD` se recorta a `[0, 1]`.
- `AGE_BUCKETS` debe tener exactamente **8** valores; si no, se restauran los defaults.
- `CAMERA_SOURCE` solo acepta `http(s)://`, `rtsp://` o `rtmp://`; otro valor se ignora con warning.
- `PORT` se fuerza a `>= 1`; la resolución mínima es 64 px; JPEG se recorta a `[30, 95]`.
- `SNAP_FOLDER` se resuelve contra la raíz del proyecto y se rechaza si escapa (`Path.relative_to`). Se revalida en **cada** snapshot.

### 9.3 Token de API

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Copiá el valor en `.env` como `API_TOKEN=...`. La UI lo pide en el campo **Token API** y lo envía como `X-Api-Token`. El token **nunca** se expone en `/api/config` ni en los logs.

---

## 10. API HTTP para integradores

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/` | No | UI (`static/index.html`). |
| GET | `/static/*` | No | CSS, JS, imágenes. |
| GET | `/video` | No* | Stream MJPEG. |
| GET | `/api/status` | No | Estado y timings. |
| GET | `/api/config` | No | Configuración pública (sin token). |
| GET | `/healthz` | No | `{"ok": true}`. |
| POST | `/api/camera/start` | Token si está definido | Inicia cámara; 503 si no abre en 8 s. |
| POST | `/api/camera/stop` | Token si está definido | Detiene cámara. |
| POST | `/api/snapshot` | Token si está definido | Guarda JPEG; 429/400/503/500. |

\* `/video` no usa token porque un `<img>` no puede enviar cabeceras. Si necesitás protegerlo, usá un proxy inverso con autenticación.

### 10.1 Ejemplos

```bash
# Salud
curl -s http://192.168.10.75:8001/healthz

# Estado legible
curl -s http://192.168.10.75:8001/api/status | python3 -m json.tool

# Stream a un archivo (10 s)
timeout 10 curl -sN http://192.168.10.75:8001/video -o /tmp/stream.mjpeg

# Snapshot con token
curl -s -X POST http://192.168.10.75:8001/api/snapshot \
  -H "X-Api-Token: $API_TOKEN"
```

```python
# Cliente Python mínimo para leer el estado
import json, urllib.request
with urllib.request.urlopen("http://192.168.10.75:8001/api/status", timeout=5) as r:
    data = json.load(r)
print(data["message"], data["fps"], data["faces_count"])
```

### 10.2 Contrato de `/api/status`

Campos estables: `camera_ok`, `model_backend`, `model_backend_requested`, `detector_backend`, `model_loaded`, `degraded`, `fps`, `faces_count`, `faces`, `resolution`, `message`, `model_error`, `camera_error`, `pipeline_error`, `pipeline_running`, `stream_clients`, `timings`.

`faces` contiene como máximo 8 elementos con `box`, `gender`, `age`, `gender_confidence`, `age_confidence` y `confidence`. **Nunca** incluye imágenes ni recortes.

---

## 11. Rendimiento y calibración

### 11.1 Benchmark disponible (ilustrativo)

| Escenario | FPS | Notas |
|---|---|---|
| V2, stream sintético 640×480, 1 rostro | 21.2 | detección 24–40 ms; clasificación ~99 ms |
| V1, mismo stream | 7.5 | Haar no detectó el rostro |
| V2, IP Webcam 1080p → 640×360 | 14.4 | detección ~87 ms; JPEG ~4.8 ms |

**No es un benchmark controlado**: V1 y V2 cambian detector, cadencia y arquitectura a la vez, y la muestra es una sola imagen. Sirve para explicar el rediseño, no para afirmar una mejora universal. Tampoco se midió 30+ minutos, ni Brio USB, ni 2–3 clientes simultáneos.

### 11.2 Qué tocar según el síntoma

| Síntoma | Ajuste |
|---|---|
| FPS bajo | Subir `INFER_EVERY_N` (8–10), `DETECT_EVERY_N` (3), bajar `YUNET_INPUT_WIDTH` (256), resolución o `JPEG_QUALITY`. |
| Etiquetas inestables | Subir `TRACK_MAX_MISSES` o bajar `TRACK_IOU_THRESHOLD`; no bajar `INFER_EVERY_N` a 1 sin necesidad. |
| No detecta caras lejanas | Subir `YUNET_INPUT_WIDTH` a 416/512; acercar la persona; mejorar la luz. |
| Falsos positivos | Subir `YUNET_SCORE_THRESHOLD`; en Haar, editar `minNeighbors` en código. |
| Latencia alta con IP Webcam | Configurar el teléfono en 640×480 y 15 fps; el stream 1080p es el cuello de botella. |

### 11.3 Cómo verificar que está bien calibrado

1. Abrí `/api/status`.
2. Con 0–1 rostros, el FPS debe acercarse a `FPS_TARGET`.
3. Mirá `timings`: si `detect_ms` domina, subí `DETECT_EVERY_N`; si domina `infer_ms`, subí `INFER_EVERY_N`; si domina `read_ms`, el problema es la red o la cámara.
4. Si `faces_count` es 0 con una persona enfrente, bajá `YUNET_SCORE_THRESHOLD` o mejorá la iluminación.
5. Si las cajas se intercambian entre dos personas, es una limitación del tracker IoU: no hay identidad.

---

## 12. Privacidad y datos biométricos

La estimación de género y edad a partir de un rostro es **dato biométrico** según el RGPD (art. 9) y muchas legislaciones locales. Aunque el modelo no identifique a la persona, el tratamiento puede requerir base legal y consentimiento.

### 12.1 Qué hace este proyecto

- Procesa **todo en local**; no envía frames, recortes ni metadatos a ningún servidor.
- **No guarda vídeo** ni historial de predicciones.
- Los **snapshots están desactivados por defecto**; si se activan, quedan en una carpeta dentro del proyecto.
- El stream `/video` no tiene autenticación por diseño (un `<img>` no puede enviar cabeceras); limitá el acceso a la LAN.
- El anuncio contextual se decide en memoria y no persiste.

### 12.2 Responsabilidades del operador

1. **Informar** a las personas que están ante una cámara y qué se muestra.
2. **Obtener consentimiento** cuando corresponda, especialmente en pantallas públicas.
3. **Minimizar**: no actives snapshots si no los necesitás; bórralos al terminar.
4. **Limitar la exposición**: no publiques el puerto 8001 en Internet; usá `API_TOKEN` y una red de confianza.
5. **No tomar decisiones automatizadas** (acceso, precio, contratación, diagnóstico) con estas etiquetas.
6. **No usar con menores** sin base legal y salvaguardas adecuadas.
7. **Respetar la normativa local** de videovigilancia y protección de datos.

> El sistema devuelve una **categoría estimada**, no una identidad. No hay embeddings, no hay comparación contra bases de datos y no hay reconocimiento facial.

---

## 13. Mantenimiento

| Tarea | Frecuencia | Comando / acción |
|---|---|---|
| Ver logs | Semanal | `journalctl -u unoq-app-v2 -n 100 --no-pager` |
| Actualizar dependencias | Con autorización | `source .venv/bin/activate && pip install -r requirements.txt` |
| Verificar salud | Semanal | `curl -s http://127.0.0.1:8001/healthz` |
| Revisar disco | Mensual | `df -h`, `du -sh snapshots/` |
| Limpiar snapshots | Según uso | Borrar manualmente; son datos biométricos |
| Rotar token | Si se compartió | Generar uno nuevo y reiniciar |
| Limpiar lente | Según polvo | Paño de microfibra; no usar alcohol fuerte |
| Actualizar modelo | Opcional | Descargar release o reentrenar; validar contrato ONNX |

---

## 14. Solución de problemas

### La UI abre pero no hay vídeo

1. `curl -s http://127.0.0.1:8001/api/status | python3 -m json.tool`.
2. Si `camera_ok: false`, revisá `camera_error`.
3. Si `message` dice `Cámara detenida`, pulsá **Iniciar cámara**.
4. Si la fuente es IP Webcam, verificá que el teléfono esté en la misma red y que `http://IP:8080/video` responda desde la placa.

### `No module named app`

Estás fuera de la raíz del proyecto. `cd` a la raíz o usá `scripts/run.sh`.

### `pip install` falla al resolver versiones

Recreá el entorno:

```bash
rm -rf .venv venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

OpenCV **>=4.12** soporta NumPy 2; no fuerces `numpy<2` con los requirements actuales.

### Permiso denegado en `/dev/video0`

```bash
sudo usermod -aG video "$USER"
# cerrar sesión y volver a entrar
```

### La cámara USB aparece y desaparece

Problema de alimentación o cable. Usá hub USB-C con PD, cable corto y puerto directo. Descartá hubs pasivos.

### Modelo ausente

```bash
ls -lh models/ models/fallback/
curl -s http://127.0.0.1:8001/api/status | python3 -m json.tool
```

- `Modelo ONNX no encontrado` → descargalo o usá `MODEL_BACKEND=caffe`.
- `Faltan modelos Caffe` → `bash scripts/download_fallback_models.sh`.
- `Error cargando ONNX` → archivo corrupto o opset incompatible; reexportá con opset 13.

### FPS bajo

Subí `INFER_EVERY_N` y `DETECT_EVERY_N`, bajá resolución o calidad JPEG. Si usás IP Webcam, configurá el teléfono en 640×480. Cerrá clientes MJPEG innecesarios: sin clientes el pipeline entra en idle.

### El snapshot devuelve 503 / 400 / 429 / 401

- **503:** `SNAP_FOLDER` vacío, snapshots deshabilitados o no hay frame.
- **400:** la carpeta configurada escapa del proyecto o no es escribible.
- **429:** esperá `SNAPSHOT_MIN_INTERVAL` segundos.
- **401:** falta `X-Api-Token` o no coincide.

### ADB no ve la placa

Cable de datos, no solo carga; aceptar el diálogo de depuración; `adb kill-server && adb start-server`; revisar `adb devices`. Si sigue vacío, la placa no está conectada o el puerto no es de datos.

### SSH timeout

IP incorrecta, red distinta o SSH apagado. Probá `ping`, `nc -vz IP 22` y `ssh -v`. En la red de demo, la placa debe estar en `192.168.10.75`; si arrancó antes que el router, ejecutá `nmcli connection up DEMO-UNOQ` en la placa.

---

## 15. Preguntas frecuentes

**¿Funciona sin internet?** Sí. La app, los modelos y la UI son locales. La demo se diseñó para una LAN aislada.

**¿Guarda vídeo?** No. Solo snapshots manuales si los habilitás.

**¿Puedo verlo desde el móvil?** Sí, si está en la misma red y abrís `http://IP:8001/`.

**¿Cuántos rostros soporta?** El contrato devuelve hasta 8; el rendimiento baja con más caras. Para demos, 1–4 es lo razonable.

**¿Por qué la edad cambia entre frames?** El clasificador es probabilístico y el tracker solo conserva la última predicción; pequeñas variaciones de luz/pose cambian el argmax. El bucket es grueso por diseño.

**¿Puedo cambiar los buckets?** Solo para ONNX, con exactamente 8 valores en `AGE_BUCKETS`. El backend Caffe tiene buckets fijos.

**¿Puedo usar otra cámara?** Sí, si expone MJPEG/RTSP o es UVC. Ajustá `CAMERA_SOURCE` o `CAMERA_INDEX`.

**¿Usa el MCU?** No. Todo corre en el MPU Linux; el STM32U585 no participa.

**¿Es seguro?** No está pensado para Internet: sin TLS y `/video` sin auth. Usalo en LAN de confianza y con `API_TOKEN` para los POST.

**¿Por qué el género es binario?** Porque el dataset y el modelo lo son. Es una limitación declarada, no una descripción de todas las personas.

**¿Puedo entrenar mi propio modelo?** Sí; el contrato está documentado en [`../training/README.md`](../training/README.md). Respetá la licencia de UTKFace y no lo uses para vigilancia.

---

## 16. Compatibilidad

| Plataforma | ¿Funciona? | Nota |
|---|---|---|
| Arduino UNO Q (MPU Linux) | ✅ Validado | QRB2210 ARM64, Debian; cámara IP Webcam validada. |
| Raspberry Pi (ARM64) | ✅ Esperado | Mismos requisitos; ajustar cámara y rendimiento. |
| PC Linux / macOS / Windows | ✅ Para desarrollo | `opencv-python-headless` y Python 3.10+. |
| Arduino AVR / ESP32 / MCU | ❌ No | No hay Python ni OpenCV; no es un sketch `.ino`. |
| App Lab | ⚠️ Parcial | `app.yaml` es opcional y no validado; el puerto del descriptor no coincide con el real. |

---

## 17. Advertencias de seguridad

1. **3,3 V en los GPIO del MCU.** Aunque esta app no use pines, no conectes 5 V sin level shifter si ampliás el proyecto.
2. **No alimentes la Brio desde un puerto débil.** Usá hub USB-C con PD o VIN + JCTL.
3. **No ejecutes la app como root.** Usá el `.venv` y el usuario `arduino`.
4. **No uses `uvicorn --workers >1`.** Duplicaría cámara, modelo y estado.
5. **No publiques el puerto 8001 en Internet.** No hay TLS.
6. **No compartas `.env`.** Puede contener `API_TOKEN` y rutas internas.
7. **Los snapshots son datos biométricos.** Activalos solo con base legal y borralos al terminar.
8. **Vigilá la temperatura** en ejecuciones largas; la inferencia sostenida calienta el MPU.
9. **No interprets las etiquetas como identidad, edad legal o diagnóstico.**
10. **No uses el proyecto para vigilancia o control de acceso.**

---

## 18. Soporte y documentación

| Documento | Para qué |
|---|---|
| [`../README.md`](../README.md) | Visión general, instalación, ejemplos, arquitectura. |
| [`developer.md`](developer.md) | Código, hilos, API interna, cómo extender. |
| [`demo-network.md`](demo-network.md) | Red de demo con router, IPs y solución de problemas. |
| [`V2.md`](V2.md) | Cambios de V1 a V2 y benchmark. |
| [`BITACORA.md`](BITACORA.md) | Problemas, decisiones y lecciones. |
| [`REFERENCES.md`](REFERENCES.md) | Enlaces oficiales y de comunidad. |
| [`../training/README.md`](../training/README.md) | Entrenamiento UTKFace y exportación ONNX. |
| [`../models/README.md`](../models/README.md) | Contrato de modelos y descarga. |

Comandos útiles de diagnóstico:

```bash
curl -s http://127.0.0.1:8001/api/status | python3 -m json.tool
curl -s http://127.0.0.1:8001/api/config | python3 -m json.tool
ls -l /dev/video*
pgrep -af "app.main|uvicorn"
journalctl -u unoq-app-v2 -n 100 --no-pager
```

---

## 19. Glosario

| Término | Definición |
|---|---|
| **MPU** | Microprocesador de aplicaciones de la UNO Q; ejecuta Linux. |
| **MCU** | Microcontrolador STM32U585; ejecuta Zephyr y no se usa aquí. |
| **UVC / V4L2** | Estándar USB de cámaras / API de vídeo de Linux. |
| **MJPEG** | Secuencia de JPEG individuales enviados como stream multipart. |
| **YuNet** | Detector de rostros pequeño y rápido de OpenCV Zoo. |
| **Haar** | Detector clásico de Viola-Jones, usado como fallback. |
| **IoU** | Intersección sobre unión; mide el solapamiento de dos cajas. |
| **Tracker** | Componente que asocia detecciones entre frames. |
| **ONNX** | Formato abierto de modelos; aquí opset 13. |
| **Caffe** | Framework clásico; aquí modelo de Levi & Hassner. |
| **Bucket** | Rango de edad discreto (8 clases). |
| **EMA** | Media móvil exponencial, usada para suavizar FPS. |
| **Modo degradado** | La app funciona sin clasificador, solo detección. |
| **Idle** | Sin clientes MJPEG; no se infiere ni se codifica. |
| **Snapshot** | JPEG manual guardado en disco; dato biométrico. |
| **RGPD** | Reglamento europeo de protección de datos; art. 9 trata datos biométricos. |

---

*Manual del usuario de AnalizadorRostroUNOQ v2. Las cifras de rendimiento están marcadas como ilustrativas; las métricas del modelo provienen del test de UTKFace y no garantizan precisión en otras poblaciones. Licencia del código: MIT (ver [`../LICENSE`](../LICENSE)).*
