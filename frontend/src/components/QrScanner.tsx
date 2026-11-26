import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, ImageUp, Loader2, RefreshCw } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

/**
 * Reads the QR code in an image (a still photo, or one video frame drawn on
 * the canvas) with jsQR. `crop` (0–1) keeps only the centre square — where
 * the frame on screen asks the QR to be — at FULL resolution: the labels'
 * QR codes carry every field of the vehicle, so they are dense, and
 * shrinking the whole picture (what it did before) made them hard to read
 * and slow. `cap` limits the pixels analysed.
 */
function decodeWithJsQr(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
  { crop = 1, cap = 900, invert = false }: { crop?: number; cap?: number; invert?: boolean } = {},
): string | null {
  if (!width || !height) return null;
  const side = crop < 1 ? Math.round(Math.min(width, height) * crop) : 0;
  const sw = side || width;
  const sh = side || height;
  const sx = side ? Math.round((width - side) / 2) : 0;
  const sy = side ? Math.round((height - side) / 2) : 0;
  const scale = Math.min(1, cap / Math.max(sw, sh));
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return (
    jsQR(image.data, image.width, image.height, {
      // The labels are dark on white: skipping the inverted pass halves the work per frame.
      inversionAttempts: invert ? "attemptBoth" : "dontInvert",
    })?.data ?? null
  );
}

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/** The browser's own QR reader (Android Chrome…): much faster and steadier than jsQR. */
async function nativeDetector(): Promise<Detector | null> {
  const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    const formats = (await BD.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formats.includes("qr_code")) return null;
    return new BD({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
  try {
    // Full HD: a dense QR needs pixels (only the centre is analysed, so it stays fast).
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (e) {
    // A camera that refuses the constraints: any camera rather than none.
    if ((e as Error)?.name === "NotAllowedError" || (e as Error)?.name === "SecurityError") throw e;
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

/**
 * Scans a QR code with the device camera (back camera on a phone). When the
 * camera is unavailable (no permission, plain HTTP, old browser) a photo of
 * the QR can be picked instead — the phone's own camera app then takes it.
 *
 * Reliability rules (field bugs 2026-11-26: the 2nd/3rd scan stayed black or
 * never fired): the camera part is mounted ONLY while the window is open, so
 * every opening starts from scratch; the camera is ALWAYS released (even when
 * the window closes while it is still starting); it restarts by itself when
 * the app comes back from the background or the camera stops; one result per
 * opening; and a "Relancer la caméra" button as a last resort.
 */
export function QrScanner({
  open,
  onClose,
  onResult,
}: {
  open: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
}) {
  return (
    // Above the bon form (z-65) and the PWA banners (z-60).
    <div className="relative z-[70]">
      <Modal open={open} onClose={onClose} title="Scanner le QR du véhicule" size="sm">
        {open && <ScannerBody onClose={onClose} onResult={onResult} />}
      </Modal>
    </div>
  );
}

function ScannerBody({ onClose, onResult }: { onClose: () => void; onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const doneRef = useRef(false);

  const deliver = useCallback((text: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    navigator.vibrate?.(80);
    onResultRef.current(text);
  }, []);

  const restart = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelNext = () => {};
    let watchdog = 0;
    let stopped = false;
    let busy = false;
    setError(null);
    setStarting(true);

    const release = () => {
      cancelNext();
      window.clearTimeout(watchdog);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    };

    (async () => {
      const detector = await nativeDetector();
      try {
        const s = await openCamera();
        if (stopped) {
          s.getTracks().forEach((t) => t.stop()); // closed while starting: never keep the camera
          return;
        }
        stream = s;
        s.getVideoTracks().forEach((t) => {
          t.addEventListener("ended", () => !stopped && !doneRef.current && restart());
          // Keep focusing while the phone moves towards the label (where the camera allows it).
          const caps = (t.getCapabilities?.() ?? {}) as { focusMode?: string[] };
          if (caps.focusMode?.includes("continuous"))
            t.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => undefined);
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        try {
          await video.play();
        } catch {
          /* autoplay hiccup: frames still arrive with muted + playsInline */
        }
        if (stopped) return;
        setStarting(false);
        // No picture after 8 s: say so instead of a black square forever.
        watchdog = window.setTimeout(() => {
          const v = videoRef.current;
          if (!stopped && v && v.readyState < v.HAVE_CURRENT_DATA) setError("La caméra ne répond pas. Touchez « Relancer la caméra » ou prenez une photo du QR.");
        }, 8000);

        // Every new camera frame is analysed as soon as the previous one is done
        // (no fixed 120 ms pause any more). Per frame:
        // - the phone's own reader (BarcodeDetector, Android) when it exists —
        //   jsQR then only every 6th frame, as a safety net, instead of on
        //   every frame on top of it (that doubled the time before);
        // - otherwise jsQR on the centre square at full resolution, and every
        //   4th frame the whole picture (a QR held off-centre).
        // jsQR results must read the SAME text on two frames in a row before
        // they are used: a wrong reading never gets through.
        let frame = 0;
        let candidate: string | null = null;
        let candidateAt = 0;
        type VideoWithFrames = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };
        const schedule = () => {
          const v = videoRef.current as VideoWithFrames | null;
          if (v?.requestVideoFrameCallback) {
            const h = v.requestVideoFrameCallback(() => void tick());
            cancelNext = () => v.cancelVideoFrameCallback?.(h);
          } else {
            const h = requestAnimationFrame(() => void tick());
            cancelNext = () => cancelAnimationFrame(h);
          }
        };
        const tick = async () => {
          if (stopped || doneRef.current) return;
          const v = videoRef.current;
          const canvas = canvasRef.current;
          if (!busy && v && canvas && v.readyState >= v.HAVE_CURRENT_DATA && v.videoWidth) {
            busy = true;
            frame += 1;
            try {
              let text: string | null = null;
              if (detector) {
                try {
                  text = (await detector.detect(v))[0]?.rawValue || null;
                } catch {
                  text = null;
                }
                if (text && !stopped) {
                  deliver(text);
                  return;
                }
              }
              if (!detector || frame % 6 === 0) {
                const whole = !detector && frame % 4 === 0;
                text = decodeWithJsQr(canvas, v, v.videoWidth, v.videoHeight, whole ? { cap: 800 } : { crop: 0.8, cap: 900 });
                if (text) {
                  const now = performance.now();
                  if (text === candidate && now - candidateAt < 1500) {
                    if (!stopped) deliver(text);
                    return;
                  }
                  candidate = text;
                  candidateAt = now;
                }
              }
            } finally {
              busy = false;
            }
          }
          if (!stopped && !doneRef.current) schedule();
        };
        schedule();
      } catch (e) {
        if (stopped) return;
        setStarting(false);
        const name = (e as Error)?.name;
        setError(
          !window.isSecureContext
            ? "La caméra demande une connexion sécurisée (https). Prenez plutôt une photo du QR code."
            : name === "NotAllowedError"
              ? "L'accès à la caméra est refusé. Autorisez la caméra pour cette application, ou prenez une photo du QR."
              : name === "NotReadableError"
                ? "La caméra est occupée par une autre application. Fermez-la puis touchez « Relancer la caméra »."
                : "La caméra n'est pas accessible. Touchez « Relancer la caméra » ou prenez une photo du QR.",
        );
      }
    })();

    // Back from the background (phone locked, another app): the camera was cut, start again.
    const onVisible = () => {
      if (document.visibilityState === "hidden") release();
      else if (!stopped && !doneRef.current) restart();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      release();
    };
  }, [attempt, deliver, restart]);

  const readPhoto = async (file: File) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const bitmap = await createImageBitmap(file);
      let text: string | null = null;
      const detector = await nativeDetector();
      if (detector) {
        try {
          text = (await detector.detect(bitmap))[0]?.rawValue || null;
        } catch {
          text = null;
        }
      }
      // A still photo: the whole picture, both polarities, more pixels (no hurry here).
      if (!text) text = decodeWithJsQr(canvas, bitmap, bitmap.width, bitmap.height, { cap: 1600, invert: true });
      bitmap.close();
      if (text) deliver(text);
      else setError("Aucun QR code lisible sur cette photo. Rapprochez-vous et réessayez.");
    } catch {
      setError("Cette image n'a pas pu être lue.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-900">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        {starting && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-300">
            <Loader2 className="animate-spin" />
          </div>
        )}
        {!starting && !error && (
          <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/90 p-6 text-center text-sm text-slate-200">
            <Camera size={28} className="text-slate-400" />
            {error}
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <p className="text-center text-xs text-slate-500 dark:text-slate-400">Placez le QR code collé sur le véhicule dans le cadre.</p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void readPhoto(file);
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={restart} className="justify-center">
          <RefreshCw size={16} /> Relancer la caméra
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()} className="justify-center">
          <ImageUp size={16} /> Photo du QR
        </Button>
      </div>
      <Button variant="ghost" onClick={onClose} className="w-full justify-center">
        Annuler
      </Button>
    </div>
  );
}
