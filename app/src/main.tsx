import { Buffer } from "buffer";
(window as any).Buffer = (window as any).Buffer ?? Buffer;
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
