import { createIntellaClient } from "@intella/shared";

const apiBaseUrl = import.meta.env.VITE_INTELLA_API_BASE_URL ?? "/api";
const authToken = import.meta.env.VITE_INTELLA_AUTH_TOKEN ?? "dev-token";

export const intellaClient = createIntellaClient({
  authToken,
  baseUrl: apiBaseUrl
});
