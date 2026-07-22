import { configDefaults } from "vitest/config";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  environments: {
    ssr: {
      keepProcessEnv: true
    }
  },
  test: {
    // Eval tests hit real Workers AI inference and need the longer timeouts
    // configured in vitest.evals.config.ts (run via `npm run eval`) — excluded
    // here so `npm test` doesn't time out / hit rate limits against them.
    exclude: [...configDefaults.exclude, "tests/evals/**"],
    // https://github.com/cloudflare/workers-sdk/issues/9822
    deps: {
      optimizer: {
        ssr: {
          include: ["ajv"]
        }
      }
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" }
      }
    }
  }
});
