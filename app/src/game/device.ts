// Phones and tablets: lighter rendering everywhere (no shadows, no MSAA, no bloom pass, 1x pixels).
export const TOUCH = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
