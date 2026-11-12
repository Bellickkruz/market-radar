import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// In development, serve /api/scout from the same handler Vercel runs in production.
function devApi(): Plugin {
  return {
    name: "market-radar-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/scout", async (req, res) => {
        const { GET } = await server.ssrLoadModule("/api/scout.ts");
        const response: Response = await GET(new Request(`http://localhost${req.originalUrl ?? req.url}`));
        res.statusCode = response.status;
        res.setHeader("content-type", "application/json");
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({ plugins: [react(), devApi()] });
