import { getDomainPack } from "./registry.ts";
import { registerFrontendDomainPack } from "./frontend/routing.ts";
import { registerFrontendProjectSignals } from "./frontend/signals.ts";
import { listProjectSignalProviders } from "../scanner/providers.ts";

if (!getDomainPack("frontend")) registerFrontendDomainPack();
if (!listProjectSignalProviders().some((provider) => provider.id === "frontend")) {
  registerFrontendProjectSignals();
}
