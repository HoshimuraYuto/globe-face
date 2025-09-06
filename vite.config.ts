import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  // Use relative paths so the app works under GitHub Pages subpaths
  base: "./",
  plugins: [react()],
});
