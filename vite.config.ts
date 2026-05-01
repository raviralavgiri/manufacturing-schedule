import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// GitHub Pages serves the site at https://<user>.github.io/<repo>/
// so production assets need that prefix. Dev server keeps "/" at root.
const REPO_NAME = "manufacturing-schedule";

export default defineConfig(({ command }) => ({
  base: command === "build" ? `/${REPO_NAME}/` : "/",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: { host: true, port: 5173 },
}));
