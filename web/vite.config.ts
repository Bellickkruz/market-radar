import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// In development, serve /api/* from the same handlers Vercel runs in production.
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
      server.middlewares.use("/api/pools", async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        let body: unknown = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || "null");
        } catch {
          body = null;
        }
        const { handlePools } = await server.ssrLoadModule("/api/pools.ts");
        const response: Response = await handlePools(body);
        res.statusCode = response.status;
        res.setHeader("content-type", "application/json");
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [react(), devApi()] };
});
