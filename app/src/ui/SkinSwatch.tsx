// A round preview of a gun skin, drawn from the same texture the gun uses.
import { useEffect, useRef } from "react";
import { skinTexture } from "../scene/Gun";

export function SkinSwatch({ i, big = false }: { i: number; big?: boolean }) {
  const N = big ? 96 : 26;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    const t = skinTexture(i);
    if (!t) {
      const gr = g.createLinearGradient(0, 0, N, N);
      gr.addColorStop(0, "#5a606c");
      gr.addColorStop(1, "#22252c");
      g.fillStyle = gr;
      g.fillRect(0, 0, N, N);
      return;
    }
    g.drawImage(t.image as CanvasImageSource, 0, 0, 128, 128, 0, 0, N, N);
  }, [i, N]);
  return <canvas ref={ref} width={N} height={N} className={big ? "lk-fill" : "cs-skin"} />;
}
