/* AnalizadorRostroUNOQ — frontend sin dependencias ni build step. */

(() => {
  "use strict";

  const els = {
    stream: document.getElementById("stream"),
    overlay: document.getElementById("stream-overlay"),
    faces: document.getElementById("faces-count"),
    hudFps: document.getElementById("hud-fps"),
    badgeCamera: document.getElementById("badge-camera"),
    badgeModel: document.getElementById("badge-model"),
    badgeFps: document.getElementById("badge-fps"),
    statusCamera: document.getElementById("status-camera"),
    statusBackend: document.getElementById("status-backend"),
    statusDetector: document.getElementById("status-detector"),
    statusModel: document.getElementById("status-model"),
    statusResolution: document.getElementById("status-resolution"),
    statusInfer: document.getElementById("status-infer"),
    statusFps: document.getElementById("status-fps"),
    message: document.getElementById("status-message"),
    btnStart: document.getElementById("btn-start"),
    btnStop: document.getElementById("btn-stop"),
    btnSnapshot: document.getElementById("btn-snapshot"),
    legendEvery: document.getElementById("legend-every"),
    legendDetect: document.getElementById("legend-detect"),
    timings: document.getElementById("timings"),
    toast: document.getElementById("toast"),
    authRow: document.getElementById("auth-row"),
    apiToken: document.getElementById("api-token"),
    cameraLive: document.getElementById("camera-live"),
    cameraState: document.getElementById("camera-state"),
    cameraSource: document.getElementById("camera-source"),
    btnProbeSource: document.getElementById("btn-probe-source"),
    btnApplySource: document.getElementById("btn-apply-source"),
    sourceInfo: document.getElementById("source-info"),
    showcase: document.getElementById("showcase"),
    adImage: document.getElementById("ad-image"),
    adContent: document.querySelector(".ad-content"),
    adBadge: document.getElementById("ad-badge"),
    adKicker: document.getElementById("ad-kicker"),
    adTitle: document.getElementById("ad-title"),
    adSubtitle: document.getElementById("ad-subtitle"),
    adPrice: document.getElementById("ad-price"),
    adCta: document.getElementById("ad-cta"),
    adReason: document.getElementById("ad-reason"),
  };

  const BACKEND_LABELS = {
    utkface_onnx: "UTKFace ONNX",
    caffe: "Caffe · Levi & Hassner",
    none: "ninguno (degradado)",
  };

  /**
   * Creatividades locales. El segmento se calcula con la predicción del
   * rostro más grande: género + tres bandas de edad (<19, 19–50, >50).
   *
   * Las seis gráficas nuevas ya incluyen su propio copy, así que se muestran
   * a pantalla completa (`overlay: false`). El anuncio de viajes por defecto
   * conserva el overlay de texto histórico (`overlay: true`).
   */
  const ADS = {
    default: {
      image: "/static/ads/travel-default.svg?v=2.2.0",
      position: "center",
      accent: "#ff7a45",
      badge: "VIAJES",
      kicker: "TEMPORADA 2026",
      title: "El destino te está esperando.",
      subtitle:
        "Playa, montaña o ciudad: elegí tu próxima escapada con tarifas " +
        "especiales y cuotas sin interés. Sin rostro detectado, el espacio " +
        "se convierte en una invitación a viajar.",
      price: "Desde US$ 399",
      priceNote: "por persona · ida y vuelta",
      cta: "Ver destinos",
      reason: "Sin rostro detectado · modo viajes.",
      overlay: true,
    },
    male_young: {
      image: "/static/ads/male-young.jpg",
      position: "center",
      accent: "#38bdf8",
      badge: "GAMING",
      kicker: "JUEGA Y CONSTRUYE",
      title: "Tu próximo mundo empieza acá.",
      subtitle:
        "Minecraft para Nintendo Switch y robots educativos: diversión, " +
        "creatividad y tecnología para armar sin límites.",
      price: "Desde US$ 49",
      priceNote: "Juego + robot",
      cta: "Ver juegos",
      reason: "Recomendado para un perfil joven.",
      overlay: false,
    },
    male_mid: {
      image: "/static/ads/male-mid.jpg",
      position: "center",
      accent: "#60a5fa",
      badge: "TECNOLOGÍA",
      kicker: "TECNOLOGÍA QUE TE ACOMPAÑA",
      title: "El próximo nivel, en tu bolsillo.",
      subtitle:
        "Smartphone de última generación y reloj inteligente: salud, " +
        "productividad y potencia para todo el día.",
      price: "US$ 899",
      priceNote: "12 cuotas sin interés",
      cta: "Ver oferta",
      reason: "Recomendado para un perfil profesional.",
      overlay: false,
    },
    male_senior: {
      image: "/static/ads/male-senior.jpg",
      position: "center",
      accent: "#c2415f",
      badge: "AUTOS",
      kicker: "TU PRÓXIMO AUTO FAMILIAR",
      title: "Espacio y seguridad para toda la familia.",
      subtitle:
        "SUV para hasta 7 pasajeros: máxima seguridad, gran capacidad y " +
        "confort en cada viaje. Bonificación de $1.000.000 por tiempo limitado.",
      price: "Bonificación de $1.000.000",
      priceNote: "por tiempo limitado",
      cta: "Agendar test drive",
      reason: "Recomendado para un perfil consolidado.",
      overlay: false,
    },
    female_young: {
      image: "/static/ads/female-young.jpg",
      position: "center",
      accent: "#d946ef",
      badge: "GAMING",
      kicker: "DIVERSIÓN SIN LÍMITES",
      title: "Jugá, escuchá y creá sin parar.",
      subtitle:
        "Nintendo Switch con Kirby y auriculares gamer: diversión y " +
        "estilo para todos tus momentos.",
      price: "US$ 299",
      priceNote: "Combo gamer",
      cta: "Comprar ahora",
      reason: "Recomendado para un perfil joven.",
      overlay: false,
    },
    female_mid: {
      image: "/static/ads/female-mid.jpg",
      position: "center",
      accent: "#f472b6",
      badge: "TECNOLOGÍA",
      kicker: "TECNOLOGÍA QUE TE ACOMPAÑA",
      title: "Todo lo que imaginás, en tu mano.",
      subtitle:
        "Smartphone, audífonos y smartwatch en rosa: la colección que " +
        "combina estilo, música y bienestar.",
      price: "US$ 749",
      priceNote: "Colección completa",
      cta: "Descubrir colección",
      reason: "Recomendado para un perfil adulto.",
      overlay: false,
    },
    female_senior: {
      image: "/static/ads/female-senior.jpg",
      position: "center",
      accent: "#d4a24c",
      badge: "VIAJES",
      kicker: "TU PRÓXIMO CRUCERO",
      title: "Descubrí nuevos destinos, viví grandes experiencias.",
      subtitle:
        "Crucero con todo incluido, gastronomía premium y excursiones: " +
        "el viaje que te merecés, con hasta 20% de descuento.",
      price: "Hasta 20% off",
      priceNote: "Reserva anticipada",
      cta: "Ver cruceros",
      reason: "Recomendado para un perfil consolidado.",
      overlay: false,
    },
  };

  const MIN_GENDER_CONF = 0.55;
  const MIN_AGE_CONF = 0.25;
  const AD_SWAP_MS = 150;

  let config = null;
  let toastTimer = null;
  let retryTimer = null;
  let adSwapTimer = null;
  let lastCameraOk = null;
  let apiToken = "";
  let currentAdKey = null;
  let currentAd = ADS.default;

  try {
    apiToken = window.sessionStorage.getItem("analizadorApiToken") || "";
  } catch (_) {
    apiToken = "";
  }

  function toast(text, kind = "info") {
    if (!els.toast) return;
    els.toast.textContent = text;
    els.toast.dataset.kind = kind;
    els.toast.dataset.visible = "true";
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.dataset.visible = "false";
    }, 4200);
  }

  function setBadge(el, text, state) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove("badge--idle", "badge--ok", "badge--warn", "badge--bad");
    el.classList.add(state ? `badge--${state}` : "badge--idle");
  }

  function showOverlay(text) {
    if (!els.overlay) return;
    if (text) {
      els.overlay.textContent = text;
      els.overlay.hidden = false;
    } else {
      els.overlay.hidden = true;
    }
  }

  function friendlyError(error, fallback) {
    if (error && error.status === 401) {
      return "Token de API requerido o inválido. Revisa el campo Token API.";
    }
    if (error && error.status === 429) {
      return error.message || "Espera unos segundos antes de otro snapshot.";
    }
    if (error && error.status === 503) {
      return `Servicio no disponible: ${error.message}`;
    }
    return `${fallback}: ${error && error.message ? error.message : "error desconocido"}`;
  }

  function persistToken(value) {
    apiToken = value.trim();
    try {
      if (apiToken) {
        window.sessionStorage.setItem("analizadorApiToken", apiToken);
      } else {
        window.sessionStorage.removeItem("analizadorApiToken");
      }
    } catch (_) {
      /* sessionStorage puede estar bloqueado; el token vive solo en memoria */
    }
  }

  async function requestJSON(url, options = {}) {
    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
    };
    if (apiToken) {
      headers["X-Api-Token"] = apiToken;
    }
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload && payload.detail ? payload.detail : `HTTP ${response.status}`;
      const error = new Error(detail);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function attachStream() {
    if (!els.stream) return;
    window.clearTimeout(retryTimer);
    els.stream.src = `/video?t=${Date.now()}`;
  }

  function scheduleRetry() {
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(attachStream, 3500);
  }

  // ------------------------------------------------------------- publicidad

  function normalizeGender(value) {
    const text = String(value || "").trim().toLowerCase();
    if (text.startsWith("masc") || text === "hombre") return "male";
    if (text.startsWith("fem") || text === "mujer") return "female";
    return null;
  }

  function ageMidpoint(label) {
    const text = String(label || "").trim();
    const range = text.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (range) {
      return (Number(range[1]) + Number(range[2])) / 2;
    }
    const plus = text.match(/(\d+)\s*\+/);
    if (plus) return Number(plus[1]) + 5;
    const single = text.match(/(\d+)/);
    return single ? Number(single[1]) : null;
  }

  function segmentFor(face) {
    const gender = normalizeGender(face && face.gender);
    if (!gender) return null;
    const midpoint = ageMidpoint(face.age);
    if (midpoint === null) return null;

    let band;
    if (midpoint < 19) band = "young";
    else if (midpoint <= 50) band = "mid";
    else band = "senior";
    return `${gender}_${band}`;
  }

  function faceArea(face) {
    if (!Array.isArray(face && face.box) || face.box.length !== 4) return 0;
    return Math.max(0, Number(face.box[2]) || 0) * Math.max(0, Number(face.box[3]) || 0);
  }

  function pickFace(faces) {
    const valid = (Array.isArray(faces) ? faces : []).filter((face) => {
      if (!face || !segmentFor(face)) return false;
      const genderConf = Number(face.gender_confidence || 0);
      const ageConf = Number(face.age_confidence || 0);
      return genderConf >= MIN_GENDER_CONF && ageConf >= MIN_AGE_CONF;
    });
    valid.sort((a, b) => {
      const areaDelta = faceArea(b) - faceArea(a);
      if (areaDelta !== 0) return areaDelta;
      return Number(b.confidence || 0) - Number(a.confidence || 0);
    });
    return valid[0] || null;
  }

  function faceSummary(face) {
    const confidence = Math.round(Number(face.confidence || 0) * 100);
    const gender = face.gender || "—";
    const age = face.age || "—";
    return `Detectado: ${gender} · ${age} · ${confidence}% de confianza.`;
  }

  function paintAd(ad, face, stateText) {
    const creativeOnly = ad.overlay === false;
    currentAd = ad;
    if (els.showcase) {
      els.showcase.style.setProperty("--ad-accent", ad.accent);
      els.showcase.style.setProperty("--ad-accent-2", ad.accent);
      els.showcase.style.setProperty(
        "--ad-bg",
        creativeOnly ? `url("${ad.image}")` : "none"
      );
      els.showcase.classList.toggle("showcase--creative", creativeOnly);
      els.showcase.classList.toggle("showcase--default", !creativeOnly);
    }
    if (els.adContent) els.adContent.hidden = creativeOnly;
    if (els.adImage) {
      els.adImage.src = ad.image;
      els.adImage.alt = `Publicidad: ${ad.title}`;
      els.adImage.style.setProperty("--ad-position", ad.position || "center");
    }
    if (els.adBadge) els.adBadge.textContent = ad.badge;
    if (els.adKicker) els.adKicker.textContent = ad.kicker;
    if (els.adTitle) els.adTitle.textContent = ad.title;
    if (els.adSubtitle) els.adSubtitle.textContent = ad.subtitle;
    if (els.adCta) els.adCta.textContent = ad.cta;
    if (els.adPrice) {
      els.adPrice.textContent = ad.price || "";
      els.adPrice.hidden = !ad.price;
      if (ad.priceNote) {
        const note = document.createElement("small");
        note.textContent = `  ${ad.priceNote}`;
        els.adPrice.appendChild(note);
      }
    }
    if (els.adReason) {
      els.adReason.textContent = face
        ? `${ad.reason} ${faceSummary(face)}`
        : stateText || ad.reason;
    }
  }

  function updateAd(faces) {
    const face = pickFace(faces);
    const segment = face ? segmentFor(face) : null;
    const key = segment || "default";
    const ad = ADS[key] || ADS.default;
    const stateText = face
      ? ""
      : Array.isArray(faces) && faces.length > 0
        ? "Analizando rostro… seguí mirando la cámara."
        : "Sin rostro detectado · modo viajes.";

    if (key === currentAdKey) {
      // Mismo segmento: solo actualizamos la línea de contexto.
      if (els.adReason) {
        els.adReason.textContent = face
          ? `${ad.reason} ${faceSummary(face)}`
          : stateText;
      }
      return;
    }

    currentAdKey = key;
    window.clearTimeout(adSwapTimer);
    if (els.showcase) els.showcase.classList.add("is-changing");
    adSwapTimer = window.setTimeout(() => {
      paintAd(ad, face, stateText);
      if (els.showcase) els.showcase.classList.remove("is-changing");
    }, AD_SWAP_MS);
  }

  function preloadAds() {
    Object.values(ADS).forEach((ad) => {
      const img = new Image();
      img.src = ad.image;
    });
  }

  // ------------------------------------------------------------------ estado

  function applyStatus(status) {
    const cameraOk = Boolean(status.camera_ok);
    const modelLoaded = Boolean(status.model_loaded);
    const pipelineRunning = Boolean(status.pipeline_running);
    const fps = Number(status.fps || 0);
    const faces = Array.isArray(status.faces) ? status.faces : [];
    const facesCount = Number(status.faces_count || faces.length || 0);
    const backend = status.model_backend || "none";
    const requested = status.model_backend_requested || "auto";

    els.faces.textContent = String(facesCount);
    els.hudFps.textContent = fps.toFixed(1);
    els.statusFps.textContent = `${fps.toFixed(1)} fps`;
    els.statusCamera.textContent = cameraOk ? "Activa" : "Sin señal";
    els.statusBackend.textContent =
      BACKEND_LABELS[backend] || `${backend} (pedido: ${requested})`;
    const detector = status.detector_backend || "none";
    els.statusDetector.textContent =
      detector === "yunet" ? "YuNet" : detector === "haar" ? "Haar" : "—";
    els.statusModel.textContent = modelLoaded ? "Cargado" : "No cargado";
    const resolution = Array.isArray(status.resolution) ? status.resolution : [];
    els.statusResolution.textContent = resolution.length === 2
      ? `${resolution[0]} × ${resolution[1]}`
      : "—";
    const every = config && config.infer_every_n ? config.infer_every_n : 5;
    els.statusInfer.textContent = `1 de cada ${every} frames`;
    if (els.timings) {
      const t = status.timings || {};
      const fmt = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—");
      els.timings.textContent = `Tiempos: detección ${fmt(t.detect_ms)} ms · clasificación ${fmt(t.infer_ms)} ms · JPEG ${fmt(t.encode_ms)} ms · ciclo ${fmt(t.loop_ms)} ms`;
    }

    if (els.cameraLive && els.cameraState) {
      els.cameraLive.classList.toggle("is-live", cameraOk && pipelineRunning);
      els.cameraState.textContent = cameraOk && pipelineRunning
        ? "en vivo"
        : cameraOk
          ? "pausada"
          : "offline";
    }

    setBadge(
      els.badgeCamera,
      cameraOk ? "Cámara activa" : "Cámara offline",
      cameraOk ? "ok" : "warn"
    );
    setBadge(
      els.badgeModel,
      modelLoaded ? BACKEND_LABELS[backend] || backend : "Sin modelo",
      modelLoaded ? "ok" : "bad"
    );
    setBadge(els.badgeFps, `FPS ${fps.toFixed(1)}`, fps > 1 ? "ok" : "warn");

    const pipelineError = status.pipeline_error ? String(status.pipeline_error) : "";
    const statusMessage = pipelineError && status.message === "OK"
      ? `Aviso del pipeline: ${pipelineError}`
      : status.message || "—";
    els.message.textContent = statusMessage;
    els.message.classList.toggle(
      "message--warn",
      Boolean(status.degraded) || !cameraOk || !modelLoaded || Boolean(pipelineError)
    );

    updateAd(faces);

    if (lastCameraOk !== null && lastCameraOk !== cameraOk) {
      attachStream();
    }
    lastCameraOk = cameraOk;

    if (!cameraOk) {
      showOverlay(
        "Cámara no disponible. Escribí la IP de IP Webcam o revisá la conexión USB."
      );
    } else {
      showOverlay("");
    }

    els.btnStart.disabled = cameraOk;
    els.btnStop.disabled = !cameraOk;
  }

  async function refreshStatus() {
    try {
      const status = await requestJSON("/api/status");
      applyStatus(status);
    } catch (error) {
      setBadge(els.badgeCamera, "Sin conexión", "bad");
      setBadge(els.badgeModel, "Sin conexión", "bad");
      setBadge(els.badgeFps, "FPS —", "warn");
      els.message.textContent = `No se pudo consultar /api/status: ${error.message}`;
      els.message.classList.add("message--warn");
      if (els.cameraLive) els.cameraLive.classList.remove("is-live");
      if (els.cameraState) els.cameraState.textContent = "sin conexión";
    }
  }

  async function loadConfig() {
    try {
      config = await requestJSON("/api/config");
      if (els.legendEvery && config.infer_every_n) {
        els.legendEvery.textContent = String(config.infer_every_n);
      }
      if (els.legendDetect && config.detect_every_n) {
        els.legendDetect.textContent = String(config.detect_every_n);
      }
      if (els.btnSnapshot) {
        els.btnSnapshot.hidden = !config.snap_enabled;
        els.btnSnapshot.title = config.snap_enabled
          ? "Guardar un JPG en la carpeta configurada"
          : "Configura SNAP_FOLDER para habilitar snapshots";
      }
      if (els.authRow) {
        els.authRow.hidden = !config.auth_enabled;
      }
      if (els.apiToken && config.auth_enabled) {
        els.apiToken.value = apiToken;
      }
      if (els.cameraSource && config.camera_source) {
        els.cameraSource.value = config.camera_source;
      }
      if (config.camera_source) {
        setSourceInfo(
          "Fuente actual cargada desde .env. Podés cambiarla y pulsar Aplicar.",
          "muted"
        );
      } else {
        const index = Number.isInteger(config.camera_index)
          ? config.camera_index
          : 0;
        setSourceInfo(
          `Sin IP configurada: se usa la cámara USB /dev/video${index}.`,
          "muted"
        );
      }
    } catch (error) {
      toast(`No se pudo leer /api/config: ${error.message}`, "error");
    }
  }

  function handleAuthError(error) {
    if (error && error.status === 401 && els.apiToken) {
      els.apiToken.focus();
    }
  }

  // ------------------------------------------------------- fuente de cámara

  function setSourceInfo(text, kind = "muted") {
    if (!els.sourceInfo) return;
    els.sourceInfo.textContent = text;
    els.sourceInfo.dataset.kind = kind;
  }

  async function probeCameraSource() {
    const value = els.cameraSource ? els.cameraSource.value.trim() : "";
    if (!value) {
      setSourceInfo("Escribí la IP del teléfono (ej: 192.168.10.249:8080).", "warn");
      if (els.cameraSource) els.cameraSource.focus();
      return;
    }
    els.btnProbeSource.disabled = true;
    setSourceInfo("Probando conexión con /photo.jpg…", "muted");
    try {
      const data = await requestJSON(
        `/api/camera/probe?url=${encodeURIComponent(value)}`
      );
      if (els.cameraSource) els.cameraSource.value = data.source;
      const resolution = Array.isArray(data.resolution) ? data.resolution : [];
      const size = resolution.length === 2
        ? ` · ${resolution[1]}×${resolution[0]}`
        : "";
      setSourceInfo(`IP Webcam responde${size}. Pulsá Aplicar para usarla.`, "ok");
      toast("IP Webcam responde correctamente");
    } catch (error) {
      handleAuthError(error);
      setSourceInfo(`No se pudo conectar: ${error.message}`, "warn");
      toast(friendlyError(error, "No se pudo probar la IP Webcam"), "error");
    } finally {
      els.btnProbeSource.disabled = false;
    }
  }

  async function applyCameraSource() {
    const value = els.cameraSource ? els.cameraSource.value.trim() : "";
    if (!value) {
      setSourceInfo("Escribí la IP del teléfono (ej: 192.168.10.249:8080).", "warn");
      if (els.cameraSource) els.cameraSource.focus();
      return;
    }
    els.btnApplySource.disabled = true;
    setSourceInfo("Aplicando y esperando el primer frame…", "muted");
    try {
      const data = await requestJSON("/api/camera/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: value }),
      });
      if (els.cameraSource) els.cameraSource.value = data.source;
      config = config || {};
      config.camera_source = data.source;
      const saved = data.persisted
        ? "Guardada en .env y conectada."
        : "Conectada, pero no se pudo guardar en .env.";
      setSourceInfo(`${saved} Fuente: ${data.source}.`, data.persisted ? "ok" : "warn");
      toast(
        data.persisted
          ? "IP Webcam guardada y conectada"
          : "IP Webcam conectada (solo esta sesión)"
      );
      attachStream();
      await refreshStatus();
    } catch (error) {
      handleAuthError(error);
      setSourceInfo(`No se pudo aplicar: ${error.message}`, "warn");
      toast(friendlyError(error, "No se pudo cambiar la fuente de cámara"), "error");
    } finally {
      els.btnApplySource.disabled = false;
    }
  }

  function bindControls() {
    if (els.apiToken) {
      els.apiToken.value = apiToken;
      els.apiToken.addEventListener("input", () => persistToken(els.apiToken.value));
      els.apiToken.addEventListener("change", () => persistToken(els.apiToken.value));
    }

    if (els.btnProbeSource) {
      els.btnProbeSource.addEventListener("click", probeCameraSource);
    }
    if (els.btnApplySource) {
      els.btnApplySource.addEventListener("click", applyCameraSource);
    }
    if (els.cameraSource) {
      els.cameraSource.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          applyCameraSource();
        }
      });
    }

    els.btnStart.addEventListener("click", async () => {
      els.btnStart.disabled = true;
      try {
        await requestJSON("/api/camera/start", { method: "POST" });
        toast("Cámara iniciada");
        attachStream();
        await refreshStatus();
      } catch (error) {
        handleAuthError(error);
        toast(friendlyError(error, "No se pudo iniciar la cámara"), "error");
        els.btnStart.disabled = false;
      }
    });

    els.btnStop.addEventListener("click", async () => {
      els.btnStop.disabled = true;
      try {
        await requestJSON("/api/camera/stop", { method: "POST" });
        toast("Cámara detenida");
        await refreshStatus();
      } catch (error) {
        handleAuthError(error);
        toast(friendlyError(error, "No se pudo detener la cámara"), "error");
      } finally {
        els.btnStop.disabled = false;
      }
    });

    els.btnSnapshot.addEventListener("click", async () => {
      els.btnSnapshot.disabled = true;
      try {
        const result = await requestJSON("/api/snapshot", { method: "POST" });
        toast(`Snapshot guardado en ${result.path}`);
      } catch (error) {
        handleAuthError(error);
        toast(friendlyError(error, "Snapshot no disponible"), "error");
      } finally {
        els.btnSnapshot.disabled = false;
      }
    });

    if (els.adCta) {
      els.adCta.addEventListener("click", () => {
        toast(`${currentAd.cta}: ${currentAd.title} · anuncio de demostración`);
      });
    }

    if (els.stream) {
      els.stream.addEventListener("error", () => {
        showOverlay("Sin señal de vídeo. Reintentando…");
        scheduleRetry();
      });
      els.stream.addEventListener("load", () => {
        if (lastCameraOk) showOverlay("");
      });
    }
  }

  async function init() {
    preloadAds();
    paintAd(ADS.default, null, "Sin rostro detectado · modo viajes.");
    bindControls();
    await loadConfig();
    attachStream();
    await refreshStatus();
    window.setInterval(refreshStatus, 1200);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
