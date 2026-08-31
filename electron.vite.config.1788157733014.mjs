// electron.vite.config.ts
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
var alias = {
  "@main": resolve("src/main"),
  "@preload": resolve("src/preload"),
  "@renderer": resolve("src/renderer"),
  "@shared": resolve("src/shared")
};
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: "out/main",
      sourcemap: true,
      rollupOptions: {
        input: resolve("src/main/index.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: "out/preload",
      sourcemap: true,
      rollupOptions: {
        input: resolve("src/preload/index.ts")
      }
    }
  },
  renderer: {
    root: resolve("src/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: { alias },
    build: {
      outDir: resolve("out/renderer"),
      emptyOutDir: true,
      sourcemap: true
    }
  }
});
export {
  electron_vite_config_default as default
};
