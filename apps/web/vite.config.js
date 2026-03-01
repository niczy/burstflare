import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vinext()],
  server: {
    host: "127.0.0.1",
    port: 3000,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      },
      "/device": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      },
      "/runtime": {
        target: "ws://127.0.0.1:8787",
        changeOrigin: true,
        ws: true
      }
    }
  }
});
