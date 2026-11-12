"""Detección de rostros (YuNet/Haar), tracker IoU y overlay.

V2 separa la detección de la clasificación para poder detectar más seguido
que lo que se ejecuta la red de género/edad. El tracker conserva las cajas
entre detecciones y evita que el overlay parpadee.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import cv2
import numpy as np

from app.models_loader import FacePrediction, ModelHandle

DEFAULT_CASCADE_NAME = "haarcascade_frontalface_default.xml"
DEFAULT_YUNET_NAME = "face_detection_yunet_2023mar.onnx"
BOX_COLOR = (0, 255, 180)
BOX_COLOR_MUTED = (0, 190, 255)
TEXT_COLOR = (10, 12, 16)
NO_MODEL_LABEL = "Rostro detectado | modelo no cargado"


@dataclass
class FaceResult:
    """Rostro detectado + predicción opcional."""

    box: Tuple[int, int, int, int]
    prediction: Optional[FacePrediction] = None

    @property
    def confidence(self) -> float:
        return self.prediction.confidence if self.prediction is not None else 0.0


def _resolve_cascade_path(haar_path: Optional[Path]) -> str:
    if haar_path is not None:
        candidate = Path(haar_path)
        if candidate.is_file():
            return str(candidate)
        raise FileNotFoundError(f"HAAR_PATH no existe: {candidate}")
    try:
        base = cv2.data.haarcascades  # type: ignore[attr-defined]
    except AttributeError as exc:  # pragma: no cover - build sin cv2.data
        raise FileNotFoundError(
            "opencv-python no incluye cv2.data; define HAAR_PATH."
        ) from exc
    return str(Path(base) / DEFAULT_CASCADE_NAME)


def _iou(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1 = max(ax, bx)
    y1 = max(ay, by)
    x2 = min(ax + aw, bx + bw)
    y2 = min(ay + ah, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter <= 0:
        return 0.0
    union = aw * ah + bw * bh - inter
    return inter / float(union) if union > 0 else 0.0


class IoUTracker:
    """Tracker mínimo por IoU: conserva cajas y predicciones entre frames."""

    def __init__(self, iou_threshold: float = 0.3, max_misses: int = 2) -> None:
        self.iou_threshold = float(iou_threshold)
        self.max_misses = max(0, int(max_misses))
        self._tracks: List[FaceResult] = []
        self._misses: List[int] = []

    def update(self, detections: Sequence[FaceResult]) -> List[FaceResult]:
        """Asocia detecciones nuevas con las cajas anteriores."""
        unmatched = list(range(len(detections)))
        new_tracks: List[FaceResult] = []
        new_misses: List[int] = []

        for track, misses in zip(self._tracks, self._misses):
            best = -1
            best_iou = self.iou_threshold
            for idx in unmatched:
                score = _iou(track.box, detections[idx].box)
                if score > best_iou:
                    best_iou = score
                    best = idx
            if best >= 0:
                det = detections[best]
                # La predicción vieja se reutiliza hasta el próximo ciclo de
                # clasificación; la caja sí se actualiza con la detección.
                det.prediction = track.prediction
                new_tracks.append(det)
                new_misses.append(0)
                unmatched.remove(best)
            else:
                new_tracks.append(track)
                new_misses.append(misses + 1)

        for idx in unmatched:
            new_tracks.append(detections[idx])
            new_misses.append(0)

        keep = [
            (track, misses)
            for track, misses in zip(new_tracks, new_misses)
            if misses <= self.max_misses
        ]
        self._tracks = [item[0] for item in keep]
        self._misses = [item[1] for item in keep]
        return list(self._tracks)

    def current(self) -> List[FaceResult]:
        return list(self._tracks)

    def reset(self) -> None:
        self._tracks.clear()
        self._misses.clear()


class FaceDetector:
    """Detector YuNet con fallback Haar y clasificación separada."""

    def __init__(
        self,
        model: ModelHandle,
        haar_path: Optional[Path] = None,
        conf_threshold: float = 0.6,
        detector_backend: str = "auto",
        yunet_model: Optional[Path] = None,
        yunet_score_threshold: float = 0.6,
        yunet_nms_threshold: float = 0.3,
        yunet_input_width: int = 320,
        scale_factor: float = 1.1,
        min_neighbors: int = 5,
        min_size: Tuple[int, int] = (60, 60),
    ) -> None:
        self.model = model
        self.conf_threshold = float(conf_threshold)
        self.scale_factor = float(scale_factor)
        self.min_neighbors = int(min_neighbors)
        self.min_size = (int(min_size[0]), int(min_size[1]))
        self.yunet_input_width = max(64, int(yunet_input_width))
        self.yunet_score_threshold = float(yunet_score_threshold)
        self.yunet_nms_threshold = float(yunet_nms_threshold)

        requested = (detector_backend or "auto").lower()
        if requested not in ("auto", "yunet", "haar"):
            requested = "auto"

        self._yunet = None
        self._cascade = None
        self.cascade_path = ""
        self.yunet_path = ""
        self.backend = "haar"

        yunet_file = yunet_model
        if yunet_file is None:
            yunet_file = Path(__file__).resolve().parent.parent / "models" / DEFAULT_YUNET_NAME
        if requested in ("auto", "yunet") and Path(yunet_file).is_file():
            try:
                self._yunet = cv2.FaceDetectorYN.create(
                    str(yunet_file),
                    "",
                    (self.yunet_input_width, int(self.yunet_input_width * 0.75)),
                    self.yunet_score_threshold,
                    self.yunet_nms_threshold,
                    5000,
                )
                self.yunet_path = str(yunet_file)
                self.backend = "yunet"
            except Exception as exc:  # pragma: no cover - depende del build
                if requested == "yunet":
                    raise RuntimeError(
                        f"No se pudo cargar YuNet ({yunet_file}): {exc}"
                    ) from exc

        if self._yunet is None:
            cascade_file = _resolve_cascade_path(haar_path)
            self._cascade = cv2.CascadeClassifier(cascade_file)
            if self._cascade.empty():
                raise RuntimeError(f"No se pudo cargar el Haar cascade: {cascade_file}")
            self.cascade_path = cascade_file
            self.backend = "haar"

        self.tracker = IoUTracker()

    # ------------------------------------------------------------ detección

    @staticmethod
    def _crop_with_margin(
        frame: np.ndarray, box: Tuple[int, int, int, int], margin: float = 0.06
    ) -> Optional[np.ndarray]:
        x, y, w, h = box
        pad_x = int(w * margin)
        pad_y = int(h * margin)
        x0 = max(0, x - pad_x)
        y0 = max(0, y - pad_y)
        x1 = min(frame.shape[1], x + w + pad_x)
        y1 = min(frame.shape[0], y + h + pad_y)
        if x1 - x0 < 8 or y1 - y0 < 8:
            return None
        return frame[y0:y1, x0:x1]

    def _detect_yunet(self, frame: np.ndarray) -> List[FaceResult]:
        h, w = frame.shape[:2]
        scale = min(1.0, self.yunet_input_width / float(max(1, w)))
        if scale < 1.0:
            small = cv2.resize(
                frame,
                (max(1, int(w * scale)), max(1, int(h * scale))),
                interpolation=cv2.INTER_AREA,
            )
        else:
            small = frame
        sh, sw = small.shape[:2]
        assert self._yunet is not None
        self._yunet.setInputSize((sw, sh))
        _, raw = self._yunet.detect(small)
        if raw is None:
            return []
        results: List[FaceResult] = []
        inv = 1.0 / scale if scale > 0 else 1.0
        for row in raw:
            score = float(row[-1])
            if score < self.yunet_score_threshold:
                continue
            x = int(round(float(row[0]) * inv))
            y = int(round(float(row[1]) * inv))
            bw = int(round(float(row[2]) * inv))
            bh = int(round(float(row[3]) * inv))
            if bw < 8 or bh < 8:
                continue
            x = max(0, min(x, w - 1))
            y = max(0, min(y, h - 1))
            bw = max(1, min(bw, w - x))
            bh = max(1, min(bh, h - y))
            results.append(FaceResult(box=(x, y, bw, bh)))
        return results

    def _detect_haar(self, frame: np.ndarray) -> List[FaceResult]:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        assert self._cascade is not None
        boxes = self._cascade.detectMultiScale(
            gray,
            scaleFactor=self.scale_factor,
            minNeighbors=self.min_neighbors,
            minSize=self.min_size,
        )
        results = [
            FaceResult(
                box=(
                    int(raw[0]),
                    int(raw[1]),
                    int(raw[2]),
                    int(raw[3]),
                )
            )
            for raw in boxes
        ]
        return results

    def detect(self, frame: np.ndarray) -> List[FaceResult]:
        """Detecta cajas; no ejecuta la red de clasificación."""
        if frame is None or frame.size == 0:
            return []
        if self.backend == "yunet":
            results = self._detect_yunet(frame)
        else:
            results = self._detect_haar(frame)
        results.sort(key=lambda item: (item.box[1] // 40, item.box[0]))
        return results

    def classify(self, frame: np.ndarray, faces: Sequence[FaceResult]) -> None:
        """Completa ``prediction`` en cada cara (si el modelo está cargado)."""
        if not self.model.loaded:
            return
        for face in faces:
            if face.prediction is not None:
                continue
            roi = self._crop_with_margin(frame, face.box)
            if roi is None or roi.size == 0:
                continue
            try:
                face.prediction = self.model.predict(roi)
            except Exception:
                face.prediction = None

    def detect_and_classify(self, frame: np.ndarray) -> List[FaceResult]:
        """Compatibilidad con llamadas antiguas."""
        faces = self.detect(frame)
        self.classify(frame, faces)
        return faces

    # --------------------------------------------------------------- dibujo

    def _label_for(self, face: FaceResult) -> Tuple[str, float]:
        prediction = face.prediction
        if prediction is None:
            return NO_MODEL_LABEL, 0.0
        gender = prediction.gender
        age = prediction.age
        if prediction.gender_conf < self.conf_threshold:
            gender = f"~{prediction.gender}?"
        if prediction.age_conf < self.conf_threshold:
            age = f"~{prediction.age}?"
        percent = int(round(max(0.0, min(1.0, prediction.confidence)) * 100))
        return f"{gender} | {age} ({percent}%)", prediction.confidence

    @staticmethod
    def _draw_text(
        frame: np.ndarray,
        text: str,
        origin: Tuple[int, int],
        scale: float,
        thickness: int,
        color: Tuple[int, int, int],
        text_color: Tuple[int, int, int] = TEXT_COLOR,
    ) -> None:
        font = cv2.FONT_HERSHEY_SIMPLEX
        (text_w, text_h), baseline = cv2.getTextSize(text, font, scale, thickness)
        x, y = origin
        y = max(y, text_h + baseline + 4)
        x = max(x, 0)
        cv2.rectangle(
            frame,
            (x, y - text_h - baseline - 4),
            (x + text_w + 8, y + baseline),
            color,
            cv2.FILLED,
        )
        cv2.putText(
            frame,
            text,
            (x + 4, y - baseline // 2 - 1),
            font,
            scale,
            text_color,
            thickness,
            cv2.LINE_AA,
        )

    def annotate(
        self,
        frame: np.ndarray,
        faces: Sequence[FaceResult],
        fps: Optional[float] = None,
        camera_ok: bool = True,
    ) -> np.ndarray:
        """Pinta cajas, etiquetas y un HUD sobre ``frame`` (in-place)."""
        width = frame.shape[1]
        scale = max(0.42, min(0.72, width / 1600.0 + 0.34))
        thickness = max(1, int(round(width / 640.0)))

        for face in faces:
            x, y, w, h = face.box
            color = BOX_COLOR if face.prediction is not None else BOX_COLOR_MUTED
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, thickness + 1)
            label, _ = self._label_for(face)
            self._draw_text(
                frame,
                label,
                (x, max(0, y - 6)),
                scale,
                thickness,
                color,
                TEXT_COLOR,
            )

        hud_parts = [f"Rostros: {len(faces)}"]
        if fps is not None:
            hud_parts.append(f"FPS: {fps:.1f}")
        if not camera_ok:
            hud_parts.append("CAMARA OFFLINE")
        self._draw_text(
            frame,
            "  |  ".join(hud_parts),
            (12, 26),
            max(0.5, scale),
            thickness,
            (28, 32, 40),
            (235, 240, 245),
        )
        return frame
