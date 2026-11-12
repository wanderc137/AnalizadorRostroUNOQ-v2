# AnalizadorRostroUNOQ v2 — Guía del desarrollador

**Audiencia:** quien va a leer, modificar o extender el código. **Alcance:** arquitectura, módulos, contratos internos, hilos, frontend, scripts y entrenamiento. Para operación y uso, ver [`datasheet.md`](datasheet.md). Para decisiones y problemas históricos, ver [`BITACORA.md`](BITACORA.md).

---

## Tabla de contenidos

1. [Mapa del proyecto](#1-mapa-del-proyecto)
2. [Flujo de datos y concurrencia](#2-flujo-de-datos-y-concurrencia)
3. [`app/config.py`](#3-appconfigpy)
4. [`app/camera.py`](#4-appcamerapy)
5. [`app/detector.py`](#5-appdetectorpy)
6. [`app/models_loader.py`](#6-appmodels_loaderpy)
7. [`app/main.py`](#7-appmainpy)
8. [Frontend](#8-frontend)
9. [Scripts de operación](#9-scripts-de-operación)
10. [Entrenamiento](#10-entrenamiento)
11. [Contratos estables](#11-contratos-estables)
12. [Guía de extensión](#12-guía-de-extensión)
13. [Verificación y pruebas](#13-verificación-y-pruebas)
14. [Deuda técnica](#14-deuda-técnica)
15. [Referencias internas](#15-referencias-internas)

---

## 1. Mapa del proyecto

```text
app/
├── config.py          Settings, .env, validación, rutas seguras
├── camera.py          captura en hilo, reconexión, último frame
├── detector.py        YuNet/Haar, tracker IoU, overlay
├── models_loader.py   ONNX/Caffe, preprocesado, FacePrediction
└── main.py            FastAPI, VideoPipeline, endpoints, MJPEG
python/main.py         entrypoint App Lab (uvicorn.run)
static/                UI vanilla: index.html, app.js, style.css, ads/
scripts/               descarga, setup, deploy, arranque, red demo
training/              train_utkface.py + workflow + README
models/                YuNet versionado; ONNX y Caffe gitignored
docs/                  manual, guía, bitácora, red, diagramas, referencias
```

### Orden de importación

`python/main.py` → `app.main` → `app.config`, `app.camera`, `app.detector`, `app.models_loader`. `app.main` crea `app = create_app()` al importar, por lo que **importar el módulo arranca la app** (y el lifespan abre cámara y pipeline). Los scripts y tests deben tenerlo en cuenta.

### Convenciones

- **Español** en mensajes de usuario, logs y documentación; **inglés** en nombres de clases/funciones cuando el dominio lo pide (`VideoPipeline`, `Camera`, `FaceDetector`).
- Sin dependencias de frontend (ni React, ni build step). El JS es vanilla y se sirve tal cual.
- Los errores se **registran y degradan**, no tumban el proceso. El pipeline sobrevive a excepciones por iteración.
- Un solo proceso y un solo worker. El estado compartido vive en memoria.

---

## 2. Flujo de datos y concurrencia

```text
┌──────────────┐   frame BGR    ┌────────────────────┐   JPEG    ┌──────────┐
│ Camera thread│ ─────────────► │ VideoPipeline thread│ ────────► │ /video   │
│ (daemon)     │  (lock)        │ (1 worker)          │  (lock)   │ clientes │
└──────────────┘                └────────────────────┘           └──────────┘
       │                                  │
       │ status/error                     │ status/faces/timings
       ▼                                  ▼
   /api/status ◄─────────────────── FastAPI (event loop)
```

### Hilos

| Hilo | Quién lo crea | Función | Terminación |
|---|---|---|---|
| `camera-capture` | `Camera.start()` | abrir, leer, reducir, publicar último frame | `Camera.stop()` setea el Event y hace join acotado. |
| `video-pipeline` | `VideoPipeline.start()` | detectar, trackear, clasificar, anotar, codificar, publicar | `VideoPipeline.stop()` setea el Event y hace join acotado. |
| Event loop | Uvicorn | endpoints, generador MJPEG, lifespan | apagado del proceso. |

### Locks

- `Camera._frame_lock`: protege `_frame`, `_frame_ts`, `_fps`, `_last_error`. `read()` devuelve una **copia** para que el pipeline no vea el frame mutado mientras se dibuja.
- `Camera._cap_lock`: evita abrir/cerrar `VideoCapture` desde dos hilos a la vez.
- `VideoPipeline._lock`: protege `_jpeg`, `_frame`, `_faces`, `_fps`, `_timings`, `_last_error`, `_placeholder_ts`.
- `VideoPipeline._lifecycle_lock`: serializa `start()`/`stop()` para que dos peticiones no creen dos workers.
- `_stream_clients`: contador entero; se incrementa al abrir `/video` y se decrementa en `finally`.

### Regla de oro de la cámara

**Solo `Camera.stop()` libera el `VideoCapture`.** Si el hilo viejo liberara al salir, podría cerrar la captura que el hilo nuevo acaba de abrir. Por eso `_release()` se llama únicamente desde `stop()` y el bucle solo deja de usar el objeto.

### Modo idle

Si `stream_clients <= 0`, el pipeline no detecta ni codifica: lee la cámara, resetea el tracker, conserva el frame para snapshots y espera 250 ms. Esto mantiene la CPU baja cuando nadie mira y evita que el último frame quede viejo.

### Placeholder

Si no hay frame, el pipeline construye un JPEG 640×480 gris con una X y los textos `CAMARA NO DISPONIBLE` / `Conecta la cámara USB o configura CAMERA_SOURCE`. Lo publica como máximo cada 1 s (para no saturar el stream) y sigue esperando.

---

## 3. `app/config.py`

### Responsabilidad

Cargar `.env`, validar valores, resolver rutas de forma segura y exponer una configuración pública sin secretos.

### Carga de entorno

- Intenta `python-dotenv`; si no está instalado, usa `_manual_load_env`, un parser simple `KEY=VALUE` que ignora comentarios y líneas vacías.
- `ENV_FILE = PROJECT_ROOT / ".env"`.
- `PROJECT_ROOT = Path(__file__).resolve().parent.parent`.

### Helpers

| Helper | Comportamiento |
|---|---|
| `_env_str(name, default)` | string o default. |
| `_env_int(name, default)` | entero; si falla, default. |
| `_env_float(name, default)` | float; si falla, default. |
| `_resolve_path(value, default)` | relativo a `PROJECT_ROOT`; absoluto se respeta. |
| `_env_path(name, default)` | combina los anteriores. |
| `_is_within(path, root)` | comprueba containment con `relative_to`. |
| `_resolve_snap_folder(raw)` | vacío → `None`; resuelve y **rechaza** fuera de `PROJECT_ROOT`. |

### `Settings`

`@dataclass` con defaults. Campos relevantes:

```python
camera_index: int = 0
camera_source: str = ""
width: int = 640
height: int = 480
fps_target: int = 15
host: str = "0.0.0.0"
port: int = 8001

model_backend: str = "auto"          # auto | utkface_onnx | caffe
detector_backend: str = "auto"       # auto | yunet | haar
yunet_model: Path
yunet_score_threshold: float = 0.6
yunet_nms_threshold: float = 0.3
yunet_input_width: int = 320
detect_every_n: int = 2
track_iou_threshold: float = 0.3
track_max_misses: int = 2

utkface_onnx_path: Path
caffe_prototxt / caffe_model / caffe_age_prototxt / caffe_age_model: Path
infer_every_n: int = 5
conf_threshold: float = 0.6
haar_path: Path | None
snap_folder: Path | None
age_buckets: list[str] = 8 buckets UTKFace
jpeg_quality: int = 80
api_token: str | None
snapshot_min_interval: float = 2.0
warnings: list[str]
```

### Validaciones de `load_settings()`

- `MODEL_BACKEND` fuera de `("auto","utkface_onnx","caffe")` → warning y `auto`.
- `DETECTOR_BACKEND` fuera de `("auto","yunet","haar")` → warning y `auto`.
- `DETECT_EVERY_N` e `INFER_EVERY_N` → `max(1, valor)`.
- `CONF_THRESHOLD` → clamp `[0,1]`.
- `AGE_BUCKETS`: split por comas; si no quedan **exactamente 8**, restaura defaults y warning.
- `CAMERA_SOURCE`: solo `http(s)://`, `rtsp://`, `rtmp://`; si no, warning y se ignora.
- `PORT` → `max(1, valor)`; resolución → mínimo 64; JPEG → `[30,95]`.
- `API_TOKEN` → `strip()`; vacío → `None`.
- `ensure_snap_folder()` al final: valida, crea y registra warning si no se puede.

### `public_config()`

Expone solo lo que la UI necesita: dimensiones, FPS, backends, `yunet_input_width`, `detect_every_n`, `track_iou_threshold`, `track_max_misses`, `infer_every_n`, `conf_threshold`, `snap_enabled`, `snapshot_min_interval`, `auth_enabled`, `age_buckets`, `camera_control=True`, `camera_type` (`url`/`usb`), `snapshot_endpoint`, `jpeg_quality`. **Nunca** `API_TOKEN`, rutas absolutas ni credenciales.

### `ensure_snap_folder()`

Se llama al cargar y **en cada snapshot**. Revalida containment porque un atacante podría cambiar un symlink después del arranque. Si la carpeta no existe, intenta crearla; si falla, deja `snap_folder=None` y warning.

### Cómo extender

Agregar un campo a `Settings`, leerlo en `load_settings()`, validarlo y decidir si debe salir en `public_config()`. No agregues secretos a `public_config()`.

---

## 4. `app/camera.py`

### Responsabilidad

Mantener el último frame disponible sin bloquear al pipeline, reabrir la fuente si falla y exponer estado legible.

### API

```python
class Camera:
    def __init__(self, source: int | str = 0, width=640, height=480,
                 fps_target=15, reconnect_delay=2.0): ...
    def start(self) -> None
    def stop(self, join_timeout=3.0) -> None
    def read(self) -> tuple[np.ndarray | None, float]
    def is_ok(self) -> bool
    @property
    def running(self) -> bool
    @property
    def fps(self) -> float
    def resolution(self) -> tuple[int, int] | None
    def status(self) -> dict
```

### Detalles de implementación

- `_is_url = isinstance(source, str) and "://" in source`; si no, `index = int(source)`.
- `start()` es idempotente: si el hilo vive, no hace nada. Crea un `threading.Event` **nuevo** por ejecución (no reutiliza el anterior, que puede estar seteado).
- `stop()` setea el Event, hace join acotado, llama **siempre** a `_release()` y limpia frame/ts/fps. Deja `last_error="Cámara detenida"`.
- `_fit_frame()` reduce a `width×height` **conservando aspecto** con `INTER_AREA`. Es necesario porque IP Webcam suele ignorar `CAP_PROP_FRAME_WIDTH/HEIGHT` y entregar 1920×1080.
- `_open()`: URL → intenta `CAP_FFMPEG`, luego `CAP_ANY`; USB → intenta `CAP_V4L2` (Linux), luego `CAP_ANY`. Setea W/H/FPS y `BUFFERSIZE=1`.
- `_loop()`: si el `VideoCapture` no está abierto, reabre; si falla 20 veces seguidas, libera, espera `reconnect_delay` y reintenta. Publica el frame bajo lock y actualiza FPS con EMA `0.9/0.1`.
- `is_ok`: `running and frame is not None and (now - frame_ts) < 3.0`.
- `status()`: `camera_ok`, `running`, `camera_index`, `camera_type` (`url`/`usb`), `fps`, `resolution`, `error`.

### Errores típicos

| Error | Causa |
|---|---|
| `No se pudo abrir la cámara USB /dev/videoN` | dispositivo ausente, permisos, índice incorrecto. |
| `No se pudo abrir la fuente de vídeo URL` | URL mal, teléfono en otra red, IP Webcam detenido. |
| `Frames consecutivos fallidos` | fuente congelada; se reabre. |

### Cómo extender

- **Otra fuente**: agregar un esquema permitido en `config.py` y el backend correspondiente en `_open()`.
- **Grabación**: no la pongas en `Camera`; un consumidor separado puede leer `read()` y escribir, pero cuidado con el coste.
- **Reconexión más agresiva**: `reconnect_delay` es parámetro del constructor; exponerlo en `.env` requiere tocar `config.py` y `main.py`.

---

## 5. `app/detector.py`

### Responsabilidad

Detectar rostros (YuNet o Haar), asociarlos entre frames con IoU, recortar ROI y dibujar el overlay.

### Constantes

```python
DEFAULT_CASCADE_NAME = "haarcascade_frontalface_default.xml"
DEFAULT_YUNET_NAME = "face_detection_yunet_2023mar.onnx"
BOX_COLOR = (0, 255, 180)        # teal: con predicción
BOX_COLOR_MUTED = (0, 190, 255)  # ámbar: sin predicción
TEXT_COLOR = (10, 12, 16)
NO_MODEL_LABEL = "Rostro detectado | modelo no cargado"
```

### `FaceResult`

```python
@dataclass
class FaceResult:
    box: tuple[int, int, int, int]   # x, y, w, h
    prediction: FacePrediction | None = None

    @property
    def confidence(self) -> float: ...
```

### `IoUTracker`

```python
class IoUTracker:
    def __init__(self, iou_threshold=0.3, max_misses=2): ...
    def update(self, detections: list[FaceResult]) -> list[FaceResult]
    def current(self) -> list[FaceResult]
    def reset(self) -> None
```

Algoritmo:

1. Para cada track vivo y cada detección, calcula IoU.
2. Ordena pares por IoU descendente y empareja greedily si `IoU > threshold`.
3. Track emparejado: actualiza caja, conserva `prediction`, resetea `misses`.
4. Detección sin par: track nuevo con `prediction=None`, `misses=0`.
5. Track sin detección: `misses += 1`; se descarta si `misses > max_misses`.

No hay IDs públicos ni re-identificación: es un tracker de cajas, no de personas. Si dos caras se cruzan, puede intercambiar predicciones.

### `FaceDetector`

```python
class FaceDetector:
    def __init__(self, model, haar_path=None, conf_threshold=0.6,
                 detector_backend="auto", yunet_model=None,
                 yunet_score_threshold=0.6, yunet_nms_threshold=0.3,
                 yunet_input_width=320,
                 scale_factor=1.1, min_neighbors=5, min_size=(60, 60)): ...

    def detect(self, frame) -> list[FaceResult]
    def classify(self, frame, faces) -> list[FaceResult]
    def detect_and_classify(self, frame) -> list[FaceResult]  # compatibilidad
    def annotate(self, frame, faces, fps=0.0, camera_ok=True) -> np.ndarray
```

- **YuNet**: `cv2.FaceDetectorYN.create(path, "", (w, int(w*0.75)), score, nms, 5000)`. `_detect_yunet` reduce el frame a `yunet_input_width`, llama `setInputSize`, detecta y escala cajas de vuelta. Filtra `score` y cajas con `bw/bh < 8`; hace clamp al frame.
- **Haar**: `cv2.CascadeClassifier(haar_path or cv2.data.haarcascades + DEFAULT_CASCADE_NAME)`; gris + `equalizeHist` + `detectMultiScale(scale_factor, min_neighbors, min_size)`.
- `backend` es `"yunet"` o `"haar"`.
- `detect()` ordena por `(y // 40, x)` para que el orden sea estable y legible.
- `classify()` solo predice si `model` está cargado y `prediction is None`; así no reclasifica caras ya etiquetadas.
- `_crop_with_margin(..., margin=0.06)` expande la caja un 6 % para incluir mentón/frente.
- `_label_for(face)` usa `prediction`; si `confidence < conf_threshold`, prefija `~` y sufija `?`. El porcentaje es `round(confidence * 100)`.
- `annotate()` dibuja cajas, etiqueta con fondo, HUD `Rostros: N | FPS: x.x` y `CAMARA OFFLINE` si corresponde. Escala fuentes/grosores según el ancho.

### Cómo extender

- **Otro detector**: devolver `list[FaceResult]` con cajas en coordenadas del frame original; el resto del pipeline no cambia.
- **Otro tracker**: respetar `update()`/`current()`/`reset()` y la semántica de conservar `prediction`.
- **Más información por rostro**: agregar campos a `FaceResult` y a `FacePrediction.as_dict()`; actualizar `/api/status` y el frontend.

---

## 6. `app/models_loader.py`

### Responsabilidad

Cargar el backend de clasificación, preprocesar la cara y devolver `FacePrediction`.

### Constantes

```python
ONNX_INPUT_SIZE = (224, 224)
ONNX_SCALE = 1 / 127.5
ONNX_MEAN = (127.5, 127.5, 127.5)
CAFFE_INPUT_SIZE = (227, 227)
CAFFE_MEAN = (78.4263377603, 87.7689143744, 114.895847746)
CAFFE_GENDER_LABELS = ("Masculino", "Femenino")
CAFFE_AGE_BUCKETS = ("0-2","4-6","8-12","15-20","25-32","38-43","48-53","60-100")
```

### `FacePrediction`

```python
@dataclass
class FacePrediction:
    gender: str
    age: str
    gender_conf: float
    age_conf: float

    @property
    def confidence(self) -> float:  # media redondeada a 3 decimales
    def as_dict(self) -> dict:      # gender, age, gender_confidence, age_confidence, confidence
```

### Helpers numéricos

- `_sigmoid(x)` con clip a ±60 para evitar overflow.
- `_softmax(x)` estable (resta el máximo).
- `_is_probability_vector(v)` comprueba suma ≈ 1 (±0.05) y rango `[0,1]`.

### `OnnxBackend`

- `cv2.dnn.readNetFromONNX(path)`; `getUnconnectedOutLayersNames()`.
- `_forward(blob)` hace **un solo** `forward`; si `cv2.error`, registra y devuelve `None`. **No reintenta** por frame (un modelo incompatible nunca va a funcionar solo).
- `_split_outputs(outputs, names)` busca nombres con `gender`/`age`; si no, infiere por tamaño: 8 = edad, 1/2 = género. Valida que el tamaño de edad coincida con `len(age_buckets)`.
- `predict(face)`:
  - `blobFromImage(face, 1/127.5, (224,224), (127.5,)*3, swapRB=True, crop=False)`.
  - Género: si 2 clases, `prob[1]` = femenino; si 1 valor, sigmoide.
  - Edad: `argmax` → `AGE_BUCKETS[i]`.
  - Redondea a 4 decimales.

### `CaffeBackend`

- Exige los 4 archivos (gender prototxt/model, age prototxt/model). Si falta uno, error claro.
- `blobFromImage(face, 1.0, (227,227), CAFFE_MEAN, swapRB=False, crop=False)`.
- Género: 2 clases, `argmax` → `CAFFE_GENDER_LABELS`.
- Edad: 8 clases fijas → `CAFFE_AGE_BUCKETS`.
- **No usa `AGE_BUCKETS`**: mezclar buckets de UTKFace con Caffe produciría etiquetas falsas.

### `ModelHandle` y `load_model`

```python
class ModelHandle:
    requested: str
    backend: OnnxBackend | CaffeBackend | None
    error: str
    name: str          # backend.name o "none"
    loaded: bool
    def predict(self, face): ...
    def describe(self) -> dict: ...
```

`load_model(settings)`:

- `utkface_onnx` → solo ONNX.
- `caffe` → solo Caffe.
- `auto` → intenta ONNX; si falla, Caffe; si ambos fallan, handle sin backend con los errores unidos.

### Cómo agregar un backend

1. Crear clase con `name`, `predict(face) -> FacePrediction | None`.
2. Añadirla a `load_model()` y a `VALID_BACKENDS` en `config.py`.
3. Documentar el contrato de entrada/salida y los buckets.
4. Actualizar `/api/config` si el backend necesita exponer algo.

---

## 7. `app/main.py`

### Responsabilidad

Servir la app FastAPI, orquestar cámara + pipeline y exponer el estado y el stream.

### `VideoPipeline`

```python
class VideoPipeline:
    CAMERA_START_TIMEOUT = 8.0
    def __init__(self, camera, detector, model, settings): ...
    def start(self) -> None
    def stop(self, join_timeout=3.0) -> None
    def add_client(self) -> int
    def remove_client(self) -> int
    def status(self) -> dict
```

Estado interno: `_lock`, `_lifecycle_lock`, `_stop` (Event), `_wake`, `_thread`, `_jpeg`, `_frame`, `_faces`, `_fps`, `_frame_index`, `_last_error`, `_placeholder_ts`, `_started`, `_stream_clients`, `_timings`.

- `start()` idempotente; crea Event nuevos por ejecución, resetea tracker y caras.
- `stop()` setea el Event, despierta y hace join acotado. No libera la cámara: eso lo hace `Camera.stop()`.
- `add_client()` incrementa y despierta; `remove_client()` decrementa con mínimo 0.
- `status()` devuelve `camera_ok`, `model_backend`, `model_backend_requested`, `detector_backend`, `model_loaded`, `degraded`, `fps`, `faces_count`, `faces` (máx 8), `resolution`, `message`, `model_error`, `camera_error`, `pipeline_error`, `pipeline_running`, `stream_clients`, `timings`.

**Precedencia del mensaje:** detector `None` → `"Detector no disponible"`; no `_started` → `"Pipeline detenido"`; no `running` → `"Pipeline detenido inesperadamente"`; cámara no running → `"Cámara detenida"`; no `camera_ok` → error o `"Cámara no disponible"`; modelo no cargado → `"Modelo no cargado: modo solo detección"`; si no, `"OK"`.

### `_loop()`

```text
while not stop:
    if stream_clients <= 0:
        idle: read, tracker.reset(), faces=[], fps=0, jpeg=None, wait(0.25)
        continue
    frame = camera.read()
    if frame is None:
        publicar placeholder cada >1 s
        wait(0.25); continue
    frame_index += 1
    if frame_index % detect_every_n == 0 or not faces:
        faces = detector.detect(frame)
    faces = tracker.update(faces)
    if frame_index % infer_every_n == 0 or any(f.prediction is None for f in faces):
        faces = detector.classify(frame, faces)
    annotated = detector.annotate(frame, faces, fps, camera.is_ok())
    jpeg = imencode(annotated, quality)
    publicar bajo lock
    fps EMA 0.85/0.15
    stop.wait(max(0, period - elapsed))
```

Cualquier excepción se captura **por iteración**: se registra, se guarda en `_last_error`, se publica el placeholder/estado y el worker sigue. Esto evita que un frame corrupto mate el stream.

### `create_app()`

- `lifespan`: arranca cámara, arranca pipeline; al apagar, detiene pipeline y luego cámara (orden inverso).
- Monta `/static`.
- `app = create_app()` al importar.
- `uvicorn.run(...)` en `__main__` y en `python/main.py`.

### Endpoints

| Ruta | Detalle |
|---|---|
| `GET /` | `FileResponse(static/index.html)`. |
| `GET /api/status` | `pipeline.status()`. |
| `GET /api/config` | `settings.public_config()`. |
| `GET /healthz` | `{"ok": True}`. |
| `POST /api/camera/start` | Si ya corre, mensaje; si no, detiene pipeline y cámara, arranca cámara, espera `is_ok` hasta 8 s; 503 si falla. |
| `POST /api/camera/stop` | Detiene cámara. |
| `POST /api/snapshot` | Rate-limit atómico (429 + `Retry-After`), valida `SNAP_FOLDER` (400), 503 si deshabilitado/sin frame, guarda JPEG con PIL o el JPEG del pipeline o `imencode`, 500 si falla. Nombre `snapshot_%Y%m%d_%H%M%S_%f` recortado a ms. |
| `GET /video` | `StreamingResponse` `multipart/x-mixed-replace; boundary=frame`, headers no-store, `yield` solo cuando cambia el JPEG; add/remove client en `try/finally`. |

### Autenticación

`_check_api_token` usa `hmac.compare_digest` y responde 401 con `WWW-Authenticate: ApiToken realm="..."`. Se aplica a los POST, no a `/video` (un `<img>` no puede enviar cabeceras).

### Rate-limit

El timestamp del último snapshot se lee y se actualiza bajo lock, de forma atómica. Si no, dos peticiones simultáneas podrían pasar el chequeo. La respuesta 429 incluye `Retry-After` con los segundos restantes.

### Cómo extender

- **Nuevo endpoint**: agregarlo en `create_app()`, documentarlo en `datasheet.md` y, si muta estado, protegerlo con token.
- **Métricas Prometheus**: exportar contadores desde `status()`; no bloquear el pipeline.
- **WebSocket de estado**: opcional; hoy el frontend hace polling cada 1.2 s y es suficiente.

---

## 8. Frontend

### Archivos

| Archivo | Rol |
|---|---|
| `static/index.html` | estructura: topbar, showcase de anuncio, panel de estado, vista en vivo, footer. |
| `static/style.css` | tema oscuro, layout responsive, badges, tarjetas. |
| `static/app.js` | polling, controles, stream, anuncios, toasts. |
| `static/ads/` | creativos locales + `CREDITS.md`. |

### Flujo de `app.js`

1. `init()`: bind de botones, `loadConfig()`, `attachStream()`, `refreshStatus()` cada 1200 ms.
2. `loadConfig()`: `GET /api/config`; muestra/oculta controles y token.
3. `attachStream()`: asigna `img.src = "/video?t=" + Date.now()` para evitar caché.
4. `refreshStatus()`: `GET /api/status`; actualiza badges, panel, HUD y anuncio.
5. `friendlyError()`: traduce códigos/mensajes a texto útil.
6. `pickFace()`: elige la cara con mayor confianza; `segmentFor()` decide la banda; `paintAd()` pinta el creativo.

### Anuncios

- `ADS` es un objeto con claves por segmento (`male_young`, `male_mid`, `male_senior`, `female_*`, `default`).
- Umbrales: `MIN_GENDER_CONF = 0.55`, `MIN_AGE_CONF = 0.25`.
- Sin rostro o baja confianza → `ADS.default` (`travel-default.svg`) y texto `"Sin rostro detectado · modo viajes."`.
- No hay historial ni almacenamiento: se decide en cada refresco con el frame actual.
- Los assets son locales; no hay peticiones a terceros en runtime.

### Cómo extender

- **Nuevo creativo**: agregar la entrada en `ADS`, el archivo en `static/ads/`, los créditos y la tabla de segmentos en `datasheet.md`.
- **Quitar publicidad**: eliminar la sección `showcase` de `index.html` y el bloque de ads de `app.js`; el resto de la UI no depende de ella.
- **Cambiar el tema**: `style.css` usa variables CSS en `:root`; empezá por ahí.

---

## 9. Scripts de operación

| Script | Qué hace | Notas |
|---|---|---|
| `download_model.sh` | Descarga el ONNX v1.0.0 del release privado. | Requiere `gh` autenticado o `curl` con token. |
| `download_fallback_models.sh` | Descarga los 4 archivos Caffe y valida tamaño > 1 MB. | ~88 MB; quedan gitignored. |
| `setup_board.sh` | Crea `.venv`, instala requirements, crea `.env`, opcionalmente modelos. | Idempotente. |
| `deploy_unoq.sh` | Copia el proyecto por ADB o SSH y ejecuta setup. | `--adb`, `--ssh`, `--setup`, `--model`. |
| `run.sh` | Activa el venv y ejecuta `python -m app.main`. | Usa el puerto de `.env`. |
| `start_server.sh` / `stop_server.sh` | `systemctl start/stop unoq-app-v2`. | Requieren sudoers configurado. |
| `demo-profile.sh` | Crea/activa el perfil WiFi `DEMO-UNOQ` con IP fija. | Rollback si no hay IP/gateway en 20 s. |
| `set_static_ip.sh` | Cambia la IP fija del perfil activo. | Útil para la red de demo. |

### Convenciones

- `set -euo pipefail` en todos.
- Los argumentos se citan siempre (`"$@"`, `"$VAR"`), especialmente en `adb shell`.
- No se copia `.env` al desplegar: se crea desde `.env.example`.
- Los scripts no instalan paquetes del sistema sin autorización explícita.

---

## 10. Entrenamiento

`training/train_utkface.py` es un CLI autocontenido. El detalle de uso está en [`../training/README.md`](../training/README.md); aquí va la arquitectura.

### Pipeline

1. `parse_buckets()` / `_bucket_bounds()` / `bucket_for_age()`: definen los 8 rangos.
2. `_clean_stem()` + `parse_filename()`: regex `^(\d{1,3})_(\d)_\d+_(.+)$` sobre el stem, con limpieza iterativa de sufijos `.chip`, `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`. `--self-test` cubre 9 casos, incluido `26_1_3_20170116174519429.jpg.chip.jpg`.
3. `collect()`: recorre el dataset, descarta corruptos con OpenCV.
4. `split()`: estratificado 80/10/10 con scikit-learn y semilla.
5. `bucketize()`: one-hot sobre el **bucket**, no sobre la edad cruda (bug clásico).
6. `build_model()`: MobileNetV2 `include_top=False`, congelada, + cabeza género (`Dense 128 → Dropout 0.5 → Dense 1 sigmoid`) + cabeza edad (`Dense 128 → Dropout 0.5 → Dense 8 softmax`).
7. `compile()`: Adam, `loss_weights` género 1.0 / edad 2.0, métricas de accuracy.
8. `unfreeze()`: opcional, últimas 30 capas con lr/10.
9. `ensure_onnx_output_names()` / `_build_nchw_export_model()`: wrapper con `Transpose` para exportar NCHW.
10. `validate()` / `export_onnx()`: opset 13, valida formas y un dummy con `onnxruntime` y `cv2.dnn`.
11. `evaluate()`: `classification_report`, matriz de confusión, `evaluation.json`.
12. `save_history()`: curvas de entrenamiento.

### Contrato de export

```text
input:  [N, 3, 224, 224] float32, RGB, x/127.5 - 1
output: gender [N, 1] sigmoid (0=M, 1=F)
        age    [N, 8] softmax en el orden de AGE_BUCKETS
opset:  13
```

Si cambiás el orden de los buckets o el preprocesado, **cambiá también** `models_loader.py` y documentalo. El contrato es el pegamento entre entrenamiento y app.

### CI

`training/train-utkface.workflow.yml` permite lanzar el entrenamiento a mano con `epochs`, `batch_size` y `fine_tune_epochs`; copialo a `.github/workflows/train-utkface.yml` para activarlo en tu fork. El run de referencia es `41117352948` (10 épocas, CPU, ~37 min, SUCCESS). El artefacto se descarga y se publica como release.

---

## 11. Contratos estables

### `/api/status`

No renombres campos sin actualizar `app.js` y la documentación. Los consumidores externos dependen de: `camera_ok`, `model_backend`, `detector_backend`, `model_loaded`, `fps`, `faces_count`, `faces`, `message`, `timings`.

### `/api/config`

Solo información pública. Si agregás un campo, que no sea secreto. `auth_enabled` indica si hay token, **no** el token.

### ONNX

Entrada NCHW 224, RGB, `x/127.5−1`. Salidas `gender` y `age` con los nombres que busca `_split_outputs`. Si el export pierde los nombres, el fallback por tamaño debe seguir funcionando (8 = edad, 1/2 = género).

### MJPEG

`multipart/x-mixed-replace; boundary=frame`. Cada parte:

```text
--frame\r\n
Content-Type: image/jpeg\r\n
Content-Length: N\r\n
\r\n
<bytes JPEG>\r\n
```

No cambies el boundary sin actualizar el frontend y la documentación.

---

## 12. Guía de extensión

### 12.1 Agregar un detector

1. Crear una clase que devuelva `list[FaceResult]` con cajas `(x,y,w,h)` en coordenadas del frame original.
2. Integrarla en `FaceDetector.__init__`/`detect()` o inyectarla en `VideoPipeline`.
3. Exponer el nombre en `detector_backend` y en `/api/config`.
4. Agregar un test con una imagen sintética y verificar que el pipeline no se rompe.

### 12.2 Agregar identidad (si algún día se necesita)

Hoy **no hay** embeddings. Si lo agregás:

- Será otro dato biométrico, con requisitos legales más fuertes.
- Necesitás una base de datos, consentimiento explícito y una política de retención.
- El tracker actual no sirve como identificación: solo asocia cajas.
- No lo presentes como "reconocimiento facial" sin anti-spoofing y evaluación de sesgos.

### 12.3 Exponer métricas

`status()` ya devuelve `timings`. Para Prometheus:

- Agregar un endpoint `/metrics` que lea contadores atómicos.
- No bloquear el pipeline con I/O.
- No exponer rutas, tokens ni datos personales.

### 12.4 Proteger `/video`

Un `<img>` no puede enviar `X-Api-Token`. Opciones:

1. Proxy inverso con autenticación (recomendado).
2. Cookie de sesión firmada y validación en el endpoint.
3. Token en query string (menos seguro; queda en logs).

### 12.5 Agregar un sensor del MCU

El MCU no participa. Si querés leer un sensor:

- El sketch Zephyr corre en el STM32U585 y expone datos por el canal que elijas (UART, USB, etc.).
- El MPU Linux debe leer ese canal y publicarlo; no metas el sensor en el pipeline de vídeo.
- Documentá el pinout y el protocolo; hoy no existe.

### 12.6 Cambiar la UI

- Mantené los IDs que usa `app.js` o actualizá ambos.
- Si agregás una vista, servila desde `static/` y montá la ruta.
- No agregues build step: el proyecto se sirve tal cual.

---

## 13. Verificación y pruebas

### Verificación estática

```bash
python -m compileall app python training
bash -n scripts/*.sh
node --check static/app.js
python training/train_utkface.py --self-test   # 9/9
```

### Pruebas manuales mínimas

1. Arrancar sin modelos: la app debe quedar en modo degradado, no caerse.
2. Arrancar sin cámara: placeholder y `/api/status` con `camera_ok: false`.
3. Conectar IP Webcam: vídeo, cajas y etiquetas.
4. Dos clientes MJPEG: el FPS no debe desplomarse; el JPEG es compartido.
5. Snapshot sin token (si `API_TOKEN` está definido): 401.
6. Snapshot repetido: 429 con `Retry-After`.
7. `SNAP_FOLDER=../fuera`: 400 y warning.
8. Detener/iniciar cámara varias veces: no deben quedar hilos ni capturas abiertas.

### Pruebas que faltan

- Unit tests del tracker (IoU, misses, reasociación).
- Unit tests del parser de UTKFace (hoy hay self-test).
- Test de contrato ONNX con un dummy.
- Test de concurrencia de snapshots.
- Test de reconexión real de cámara.

### Checklist antes de desplegar

- [ ] `requirements.txt` instalado en `.venv`.
- [ ] Modelo ONNX o Caffe presente; `/api/status` con `model_loaded: true`.
- [ ] Cámara OK (`camera_ok: true`).
- [ ] `API_TOKEN` definido si la red no es de confianza.
- [ ] `SNAP_FOLDER` dentro del proyecto o snapshots desactivados.
- [ ] Puerto 8001 libre.
- [ ] `workers=1`.
- [ ] Logs revisados tras 5 minutos de uso.

---

## 14. Deuda técnica

| Deuda | Impacto | Idea de solución |
|---|---|---|
| Sin tests unitarios | Regresiones silenciosas en tracker/parser. | `pytest` con imágenes sintéticas y mocks de cámara. |
| Sin IDs de track | No se puede seguir una persona entre cruces. | Agregar IDs y, si se requiere, un re-ID (con cautela legal). |
| `app.yaml` desactualizado | El descriptor mapea 8000 y no se validó. | Corregir a 8001 o eliminar el descriptor. |
| Frontend sin build | Difícil escalar a componentes. | Mantener vanilla por simplicidad; no agregar React sin motivo. |
| Sin TLS | `/video` y POST viajan en claro. | Proxy inverso con TLS y auth. |
| Sin anti-spoofing | Una foto puede pasar. | Detector de vida (parpadeo, profundidad) si el uso lo exige. |
| Benchmark no controlado | Las cifras no son comparables. | Protocolo fijo: misma imagen, misma resolución, 3 corridas, mediana. |
| Sin métricas de sesgo | No se conoce el error por grupo demográfico. | Evaluar UTKFace por subgrupos y documentar. |
| `PLAN.md`/`AUDIT_REPORT.md` internos | No se publican. | Mantenerlos fuera del repo público. |

---

## 15. Referencias internas

| Documento | Contenido |
|---|---|
| [`../README.md`](../README.md) | Visión general, instalación, ejemplos, "Cómo fue construido". |
| [`datasheet.md`](datasheet.md) | Manual de usuario, operación, privacidad. |
| [`BITACORA.md`](BITACORA.md) | Problemas, decisiones descartadas, lecciones. |
| [`V2.md`](V2.md) | Cambios V1→V2 y benchmark. |
| [`demo-network.md`](demo-network.md) | Red de demo, IPs, router, cold start. |
| [`REFERENCES.md`](REFERENCES.md) | Enlaces oficiales y de comunidad. |
| [`../training/README.md`](../training/README.md) | Entrenamiento UTKFace. |
| [`../models/README.md`](../models/README.md) | Contratos de modelos. |
| `../static/index.html` | UI real, sin mockups. |
| `../docs/assets/architecture.svg` | Arquitectura visual. |
| `../docs/assets/pipeline.svg` | Ciclos y tracker. |
| `../docs/assets/training.svg` | Entrenamiento y export. |
| `../docs/assets/network-demo.svg` | Topología de red. |

---

*Guía del desarrollador de AnalizadorRostroUNOQ v2. Si cambiás un contrato (ONNX, `/api/status`, MJPEG), actualizá esta guía, el manual y el README en el mismo commit.*
