/**
 * Scanner de code-barres par caméra — AMÉLIORATION PROGRESSIVE.
 *
 * S'appuie sur l'API native `window.BarcodeDetector` (Chrome/Edge/Android) —
 * aucune dépendance externe, aucun polyfill embarqué. Sur les autres
 * navigateurs (Safari/Firefox à ce jour), le bouton d'accès n'est simplement
 * pas affiché : la douchette USB et la saisie restent le chemin universel.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface DetectedCode {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedCode[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: {
      formats?: string[];
    }) => BarcodeDetectorLike;
  }
}

/** Scan caméra disponible sur cet appareil/navigateur ? */
export function cameraScanSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.BarcodeDetector === "function" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

export function CameraScanner({
  onDetect,
  onClose,
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let fired = false;
    const Ctor = window.BarcodeDetector;
    if (!Ctor) {
      setError(t("scan.camera.unavailable"));
      return undefined;
    }
    const detector = new Ctor({
      formats: ["ean_13", "ean_8", "code_39", "code_128", "upc_a", "qr_code"],
    });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // play() peut lever en synchrone (jsdom) ou rejeter (autoplay policy)
        try {
          const playing: unknown = video.play();
          if (
            playing &&
            typeof (playing as Promise<void>).catch === "function"
          ) {
            await (playing as Promise<void>).catch(() => undefined);
          }
        } catch {
          /* lecture non requise pour détecter les frames */
        }
        setReady(true);
        const tick = async () => {
          if (stopped || fired) return;
          try {
            const codes = await detector.detect(video);
            const code = codes.find(
              (x) => x.rawValue && x.rawValue.trim() !== "",
            );
            if (code?.rawValue) {
              fired = true;
              onDetect(code.rawValue.trim());
              return;
            }
          } catch {
            /* trame illisible : on réessaie à la prochaine frame */
          }
          if (!stopped) raf = requestAnimationFrame(() => void tick());
        };
        raf = requestAnimationFrame(() => void tick());
      } catch {
        setError(t("scan.camera.denied"));
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scanner-box">
      {error ? (
        <p className="muted" role="alert">
          ⚠️ {error}
        </p>
      ) : (
        <>
          <video
            ref={videoRef}
            className="scanner-video"
            muted
            playsInline
            aria-label={t("scan.camera.videoAria")}
          />
          <div className="scanner-reticle" aria-hidden />
          <p className="muted" style={{ textAlign: "center", marginTop: 8 }}>
            {ready ? t("scan.camera.aim") : t("scan.camera.starting")}
          </p>
        </>
      )}
      <button
        type="button"
        className="btn btn-outline btn-sm"
        style={{ marginTop: 8, width: "100%" }}
        onClick={onClose}
      >
        {t("scan.camera.close")}
      </button>
    </div>
  );
}
