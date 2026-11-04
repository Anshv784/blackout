// A round preview of a gun skin, drawn from the same texture the gun uses.
import { useEffect, useRef } from "react";
import { skinTexture } from "../scene/Gun";

export function SkinSwatch({ i }: { i: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    const t = skinTexture(i);
    if (!t) {
      g.fillStyle = "#3a3f4a";
      g.fillRect(0, 0, 26, 26);
      return;
    }
    g.drawImage(t.image as CanvasImageSource, 0, 0, 64, 64, 0, 0, 26, 26);
  }, [i]);
  return <canvas ref={ref} width={26} height={26} className="cs-skin" />;
}
