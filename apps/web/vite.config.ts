import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Accept the Tailscale MagicDNS Host header. `tailscale serve` terminates
    // TLS on the host and proxies to 127.0.0.1:5173 while preserving the
    // original Host (e.g. macintosh.tail5981df.ts.net); Vite 7 would otherwise
    // reject it as a disallowed host. Loopback/IP hosts are always allowed, so
    // local dev is unaffected. Leading-dot matches the domain and subdomains.
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
