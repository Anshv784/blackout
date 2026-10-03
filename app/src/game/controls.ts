// Shared mutable input state (keyboard, mouse, touch joysticks). Read every frame.
export const controls = {
  keys: new Set<string>(),
  fire: false,
  reload: false,
  mouseActive: false,
  touchMove: null as [number, number] | null,
  touchAim: null as number | null,
  touchFire: false,
};

let installed = false;
export function installKeyboard() {
  if (installed) return;
  installed = true;
  const norm = (k: string) => k.toLowerCase();
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    const k = norm(e.key);
    controls.keys.add(k);
    if (k === "r") controls.reload = true;
    if (k === " ") controls.fire = true;
  });
  window.addEventListener("keyup", (e) => {
    const k = norm(e.key);
    controls.keys.delete(k);
    if (k === "r") controls.reload = false;
    if (k === " ") controls.fire = false;
  });
  window.addEventListener("blur", () => {
    controls.keys.clear();
    controls.fire = false;
    controls.reload = false;
  });
}
