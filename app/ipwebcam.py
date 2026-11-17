"""Normalización y sondeo de una cámara IP Webcam.

La interfaz permite escribir solo la IP del teléfono, la IP con puerto o una
URL completa. Este módulo la convierte a la URL canónica que consume OpenCV
(``http://IP:8080/video``) y permite probar la conexión descargando un still
de ``/photo.jpg`` sin abrir el stream MJPEG.

El patrón está inspirado en ``superfoto-unoq`` (misma normalización y misma
prueba con ``/photo.jpg``), adaptado a las dependencias de este proyecto.
"""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from urllib.parse import urlsplit, urlunsplit

DEFAULT_IPWEBCAM_PORT = 8080
IPWEBCAM_STREAM_PATH = "/video"
IPWEBCAM_PHOTO_PATH = "/photo.jpg"
MAX_SOURCE_LENGTH = 2048
MAX_PHOTO_BYTES = 12 * 1024 * 1024

_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*://")
_ALLOWED_SCHEMES = ("http", "https", "rtsp", "rtmp")


class SourceError(ValueError):
    """Valor de fuente inválido o cámara inalcanzable.

    ``kind`` permite mapear el error a un código HTTP: ``invalid`` (400) para
    valores mal formados y ``connection``/``decode`` (502) para fallos del
    dispositivo remoto.
    """

    def __init__(self, message: str, kind: str = "invalid") -> None:
        super().__init__(message)
        self.kind = kind


def normalize_camera_source(value: str) -> str:
    """Normaliza una IP/URL de IP Webcam a una URL canónica terminada en /video.

    Acepta todas estas formas (y devuelve siempre lo mismo)::

        192.168.10.75
        192.168.10.249:8080
        http://192.168.10.249:8080
        http://192.168.10.249:8080/video
        https://192.168.10.249:8080/video
        http://192.168.10.249:8080/photo.jpg

    Reglas: si falta el esquema se usa ``http``; si falta el puerto se usa
    8080; un path vacío, ``/`` o ``/photo.jpg`` se convierte en ``/video``.
    Las URLs ``rtsp://`` y ``rtmp://`` se aceptan tal cual (sin completar
    puerto ni path).
    """
    if not isinstance(value, str) or not value.strip():
        raise SourceError(
            "Escribí la IP o URL del teléfono (ej: 192.168.10.249:8080)"
        )
    raw = value.strip()
    if len(raw) > MAX_SOURCE_LENGTH:
        raise SourceError(
            f"La URL es demasiado larga (máximo {MAX_SOURCE_LENGTH} caracteres)"
        )
    if not _SCHEME_RE.match(raw):
        raw = "http://" + raw

    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError as exc:
        raise SourceError(
            "URL inválida: revisá el puerto (debe estar entre 1 y 65535)"
        ) from exc

    scheme = (parts.scheme or "").lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise SourceError(
            f"Esquema no soportado: '{scheme or '?'}'. "
            "Usá http://, https://, rtsp:// o rtmp://"
        )
    host = parts.hostname
    if not host:
        raise SourceError(
            "La URL no tiene host/IP (ej: 192.168.10.249:8080)"
        )
    if any(ch.isspace() for ch in (parts.netloc or "")):
        raise SourceError("El host no puede tener espacios")

    if scheme in ("rtsp", "rtmp"):
        return urlunsplit((scheme, parts.netloc, parts.path, parts.query, ""))

    if port is None:
        port = DEFAULT_IPWEBCAM_PORT
    if not 1 <= int(port) <= 65535:
        raise SourceError("Puerto inválido: debe estar entre 1 y 65535")

    host_part = f"[{host}]" if ":" in host else host
    userinfo = ""
    if parts.username:
        userinfo = parts.username
        if parts.password:
            userinfo += ":" + parts.password
        userinfo += "@"

    path = (parts.path or "").rstrip("/")
    low = path.lower()
    if not path:
        path = IPWEBCAM_STREAM_PATH
    elif low.endswith(IPWEBCAM_PHOTO_PATH):
        prefix = path[: -len(IPWEBCAM_PHOTO_PATH)]
        path = f"{prefix}{IPWEBCAM_STREAM_PATH}"
    elif low.endswith(IPWEBCAM_STREAM_PATH):
        # Se conserva un prefijo propio (/cam/video); el sufijo se canoniza.
        path = path[: -len(IPWEBCAM_STREAM_PATH)] + IPWEBCAM_STREAM_PATH
    else:
        # Cualquier otro path (p. ej. /stream, /mjpeg) se canoniza a /video.
        path = IPWEBCAM_STREAM_PATH

    return f"{scheme}://{userinfo}{host_part}:{int(port)}{path}"


def ip_webcam_photo_url(source: str) -> str:
    """Deriva la URL del still ``/photo.jpg`` a partir de la fuente canónica."""
    canonical = normalize_camera_source(source)
    parts = urlsplit(canonical)
    if parts.scheme not in ("http", "https"):
        raise SourceError(
            "La prueba con /photo.jpg solo aplica a IP Webcam por http(s)",
            kind="invalid",
        )
    base = (
        canonical[: -len(IPWEBCAM_STREAM_PATH)]
        if canonical.endswith(IPWEBCAM_STREAM_PATH)
        else canonical
    )
    return f"{base}{IPWEBCAM_PHOTO_PATH}"


def probe_ip_webcam(value: str, timeout: float = 3.0) -> dict:
    """Prueba una IP Webcam descargando un still de ``/photo.jpg``.

    Devuelve ``{ok, source, photo_url, resolution, content_type, bytes}`` o
    lanza ``SourceError`` con ``kind`` = ``invalid`` | ``connection`` |
    ``decode``. No abre el stream MJPEG: no interrumpe la captura actual.
    """
    canonical = normalize_camera_source(value)
    photo_url = ip_webcam_photo_url(canonical)
    request = urllib.request.Request(
        photo_url, headers={"User-Agent": "AnalizadorRostroUNOQ/2.0"}
    )
    try:
        with urllib.request.urlopen(request, timeout=float(timeout)) as response:
            content_type = response.headers.get("Content-Type", "") or ""
            data = response.read(MAX_PHOTO_BYTES)
    except urllib.error.HTTPError as exc:
        raise SourceError(
            f"El teléfono respondió HTTP {exc.code} al pedir /photo.jpg",
            kind="connection",
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        host = urlsplit(canonical).netloc
        raise SourceError(
            f"No se pudo conectar con {host}: {reason}", kind="connection"
        ) from exc

    if not data:
        raise SourceError(
            "El teléfono respondió sin datos en /photo.jpg", kind="decode"
        )
    # Import perezoso: normalizar la IP no debe exigir OpenCV/Numpy.
    import cv2
    import numpy as np

    frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise SourceError(
            "La respuesta de /photo.jpg no es una imagen válida", kind="decode"
        )
    return {
        "ok": True,
        "source": canonical,
        "photo_url": photo_url,
        "resolution": [int(frame.shape[0]), int(frame.shape[1])],
        "content_type": content_type,
        "bytes": len(data),
    }
