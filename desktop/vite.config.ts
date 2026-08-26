import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(desktopDirectory, "..");

export default defineConfig({
  // Reuse the exact entry point used by GitHub Pages. This keeps the desktop
  // build aligned with app/page.tsx and app/globals.css.
  root: path.join(projectDirectory, "github-pages"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: path.join(desktopDirectory, "dist"),
    emptyOutDir: true,
  },
});
