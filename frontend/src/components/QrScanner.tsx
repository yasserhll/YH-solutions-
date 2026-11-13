import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, ImageUp, Loader2 } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

/** Reads the QR code in an image (a still photo, or one video frame drawn on the canvas). */
function decode(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
): string | null {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return (
    jsQR(image.data, image.width, image.height, {
      inversionAttempts: "attemptBoth",
    })?.data ?? null
  );
}

/**
 * Scans a QR code with the device camera (back camera on a phone). When the
 * camera is unavailable (no permission, plain HTTP, old browser) a photo of
 * the QR can be picked instead — the phone's own camera app then takes it.
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  // The latest callback, without restarting the camera each time the parent re-renders.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    setError(null);
    setStarting(true);

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= video.HAVE_ENOUGH_DATA) {
        const text = decode(canvas, video, video.videoWidth, video.videoHeight);
        if (text) {
          stopped = true;
          navigator.vibrate?.(80);
          onResultRef.current(text);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("unsupported");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStarting(false);
        frame = requestAnimationFrame(tick);
      } catch {
        setStarting(false);
        setError(
          window.isSecureContext
            ? "La caméra n'est pas accessible (autorisation refusée ?). Prenez plutôt une photo du QR code."
            : "La caméra demande une connexion sécurisée (https). Prenez plutôt une photo du QR code.",
        );
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  const readPhoto = async (file: File) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const bitmap = await createImageBitmap(file);
      const text = decode(canvas, bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      if (text) onResult(text);
      else
        setError(
          "Aucun QR code lisible sur cette photo. Rapprochez-vous et réessayez.",
        );
    } catch {
      setError("Cette image n'a pas pu être lue.");
    }
  };

  return (
    // Above the bon form (z-65) and the PWA banners (z-60).
    <div className="relative z-[70]">
      <Modal
        open={open}
        onClose={onClose}
        title="Scanner le QR du véhicule"
        size="sm"
      >
        <div className="space-y-3">
          <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-900">
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-300">
                <Loader2 className="animate-spin" />
              </div>
            )}
            {!starting && !error && (
              <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
            )}
            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-200">
                <Camera size={28} className="text-slate-400" />
                {error}
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Placez le QR code collé sur le véhicule dans le cadre.
          </p>
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
          <div className="flex justify-between gap-2">
            <Button
              variant="secondary"
              onClick={() => fileRef.current?.click()}
            >
              <ImageUp size={16} /> Photo du QR
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
