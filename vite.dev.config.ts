import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The repository root contains the generated GitHub Pages index.html. Keep
// local development on the source entry point so `npm run dev` cannot load a
// stale deployment bundle and render a blank page.
export default defineConfig({
  root: "github-pages",
  base: "/",
  plugins: [react()],
});
