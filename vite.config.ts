import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ["examples/ui-automation/**", "seed.spec.ts", "node_modules/**", "dist/**"],
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});

