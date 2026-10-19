/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.png", "apple-touch-icon.png"],
      manifest: {
        name: "Padel Rotation",
        short_name: "Padel",
        description: "Fair padel rotations and an Americano score tracker",
        theme_color: "#0B3A33",
        background_color: "#F1F5F2",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "icon.png", sizes: "256x256", type: "image/png", purpose: "any" }],
      },
      workbox: {
        // pdf.js and its worker are big; cache them so the app works offline at the courts
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ["**/*.{js,mjs,css,html,png,svg,webmanifest}"],
      },
    }),
  ],
  test: {
    environment: "node",
  },
});
