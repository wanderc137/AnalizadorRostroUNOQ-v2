# Referencias

Enlaces oficiales y de comunidad usados para construir, entrenar y desplegar el proyecto. Cada entrada incluye **para qué sirve**. La mayoría se verificó en noviembre de 2026; los documentos de OpenCV pueden devolver `403` a clientes automáticos, pero las URLs son las oficiales.

---

## Hardware y plataforma

| Recurso | Utilidad |
|---|---|
| [Arduino UNO Q — producto](https://www.arduino.cc/product-uno-q) | Descripción de la placa, MPU + MCU y capacidades. |
| [Arduino UNO Q — documentación de hardware](https://docs.arduino.cc/hardware/uno-q) | Especificaciones, pines y alimentación. |
| [Arduino App Lab](https://docs.arduino.cc/software/app-lab) | Entorno oficial para apps Python en la UNO Q. |
| [Debian](https://www.debian.org/) | Base del Linux ARM64 del MPU. |
| [STM32U585](https://www.st.com/en/microcontrollers-microprocessors/stm32u585ai.html) | MCU de la placa; **no** se usa en esta app. |
| [Zephyr Project](https://zephyrproject.org/) | RTOS del MCU; **no** se usa en esta app. |

## Detección de rostros

| Recurso | Utilidad |
|---|---|
| [YuNet — paper](https://link.springer.com/article/10.1007/s11633-023-1423-y) | Detector tiny usado por OpenCV; fundamento del rendimiento. |
| [OpenCV Zoo — face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | Modelo y licencia MIT; de aquí sale el `.onnx`. |
| [`cv::FaceDetectorYN`](https://docs.opencv.org/4.x/df/d20/classcv_1_1FaceDetectorYN.html) | API de OpenCV para cargar y ejecutar YuNet. |
| [Haar cascades de OpenCV](https://github.com/opencv/opencv/tree/4.x/data/haarcascades) | Cascadas incluidas; usadas como fallback. |
| [Viola & Jones (2001)](https://doi.org/10.1109/CVPR.2001.990517) | Paper original del detector Haar. |

## Datos y modelos de género/edad

| Recurso | Utilidad |
|---|---|
| [UTKFace — sitio oficial](https://susanqq.github.io/UTKFace/) | Dataset, etiquetas y condiciones de uso. |
| [UTKFace — paper](https://arxiv.org/abs/1702.02429) | Metodología y sesgos del dataset. |
| [UTKFace en Kaggle](https://www.kaggle.com/datasets/jangedoo/utkface-new) | Descarga usada por el entrenamiento. |
| [Levi & Hassner (2015)](https://openaccess.thecvf.com/content_cvpr_workshops_2015/W08/papers/Levi_Age_and_Gender_2015_CVPR_paper.pdf) | Modelo Caffe de género/edad y buckets fijos. |
| [smahesh29/Gender-and-Age-Detection](https://github.com/smahesh29/Gender-and-Age-Detection) | Pesos Caffe usados como fallback. |
| [MobileNetV2](https://arxiv.org/abs/1801.04381) | Backbone del modelo ONNX. |

## Stack de aplicación

| Recurso | Utilidad |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | Framework web y documentación de endpoints. |
| [FastAPI — custom responses](https://fastapi.tiangolo.com/advanced/custom-response/) | Base del `StreamingResponse` MJPEG. |
| [Uvicorn](https://uvicorn.dev/) | Servidor ASGI; se ejecuta con `workers=1`. |
| [OpenCV](https://opencv.org/) | Captura, DNN, dibujo y códec JPEG. |
| [ONNX](https://onnx.ai/) | Formato del modelo y especificación de opset. |
| [ONNX Runtime](https://onnxruntime.ai/) | Validación del modelo exportado. |
| [tensorflow-onnx / tf2onnx](https://github.com/onnx/tensorflow-onnx) | Conversión Keras → ONNX. |
| [TensorFlow](https://www.tensorflow.org/) | Entrenamiento de MobileNetV2. |
| [scikit-learn](https://scikit-learn.org/) | Split estratificado y métricas. |
| [NumPy](https://numpy.org/) | Álgebra y preprocesado. |
| [Pillow](https://pillow.readthedocs.io/) | Codificación JPEG de snapshots. |
| [python-dotenv](https://github.com/theskumar/python-dotenv) | Carga de `.env` (con fallback propio). |

## Vídeo, protocolos y cámaras

| Recurso | Utilidad |
|---|---|
| [RFC 2046 — multipart](https://www.rfc-editor.org/rfc/rfc2046) | Especificación detrás de `multipart/x-mixed-replace`. |
| [Motion JPEG](https://en.wikipedia.org/wiki/Motion_JPEG) | Qué es MJPEG y por qué se eligió. |
| [V4L2 — Linux kernel](https://www.kernel.org/doc/html/latest/drivers/media/v4l2-core/v4l2-dev.html) | API de captura USB en Linux. |
| [FFmpeg](https://ffmpeg.org/) | Backend para URLs MJPEG/RTSP. |
| [IP Webcam (Google Play)](https://play.google.com/store/apps/details?id=com.pas.webcam) | App usada para convertir un teléfono en cámara MJPEG. |
| [DroidCam](https://www.dev47apps.com/) | Alternativa de cámara por WiFi/USB. |

## Red de demo e infraestructura

| Recurso | Utilidad |
|---|---|
| [OpenWrt](https://openwrt.org/) | Firmware del router de la demo. |
| [TP-Link TL-MR3420 — OpenWrt](https://openwrt.org/toh/tp-link/tl-mr3420) | Soporte, instalación y recuperación del router. |
| [UCI](https://openwrt.org/docs/guide-user/base-system/uci) | Configuración de WiFi y DHCP por CLI. |
| [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) | Unidad `unoq-app-v2`. |
| [Avahi](https://avahi.org/) | mDNS (`analizador-v2.local`). |
| [GitHub Actions](https://docs.github.com/en/actions) | Entrenamiento en CI y artefactos. |

## Privacidad y normativa

| Recurso | Utilidad |
|---|---|
| [RGPD — Reglamento (UE) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj) | Base legal para datos biométricos (art. 9). |

---

## Cómo se eligieron estas fuentes

- **Documentación oficial primero** (OpenCV, FastAPI, ONNX, Debian, Arduino, OpenWrt). Los blogs y respuestas de foro se usaron solo para diagnóstico y se contrastaron con el código o con una medición.
- **Papers originales** para las decisiones de modelo (YuNet, MobileNetV2, Levi & Hassner, Viola-Jones, UTKFace).
- **Repositorios de los autores** para pesos y licencias; se conserva `models/YUNET_LICENSE` y se documentan las licencias de Caffe y UTKFace.
- **Sin enlaces a capturas inventadas**: la UI real está en [`../static/index.html`](../static/index.html).

> Si un enlace deja de responder, buscá el recurso por su título y autor; las URLs de documentación cambian con las versiones. La fecha de esta lista es 2026-11.
