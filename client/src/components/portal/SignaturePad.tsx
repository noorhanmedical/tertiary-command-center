import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, Check } from "lucide-react";

type Props = {
  onCapture: (dataUrl: string) => void;
  height?: number;
  disabled?: boolean;
};

export function SignaturePad({ onCapture, height = 180, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.2;
  }, [height]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.preventDefault();
    drawingRef.current = true;
    lastRef.current = pos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !lastRef.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    setHasDrawn(true);
  }
  function end() {
    drawingRef.current = false;
    lastRef.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, height);
    setHasDrawn(false);
  }

  function capture() {
    if (!canvasRef.current || !hasDrawn) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onCapture(dataUrl);
  }

  return (
    <div className="space-y-2" data-testid="signature-pad">
      <canvas
        ref={canvasRef}
        style={{ height, touchAction: "none" }}
        className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        data-testid="signature-canvas"
      />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={disabled} data-testid="button-signature-clear">
          <Eraser className="mr-1 h-3.5 w-3.5" /> Clear
        </Button>
        <Button type="button" size="sm" onClick={capture} disabled={disabled || !hasDrawn} data-testid="button-signature-confirm">
          <Check className="mr-1 h-3.5 w-3.5" /> Use signature
        </Button>
      </div>
    </div>
  );
}
