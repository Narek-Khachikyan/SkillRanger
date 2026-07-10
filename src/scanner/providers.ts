import type { ProjectSignalProvider } from "./types.ts";

const providers = new Map<string, ProjectSignalProvider>();

export const registerProjectSignalProvider = (provider: ProjectSignalProvider) => {
  if (providers.has(provider.id)) {
    throw new Error(`Project signal provider already registered: ${provider.id}`);
  }
  providers.set(provider.id, provider);
  return provider;
};

export const listProjectSignalProviders = () =>
  [...providers.values()].sort((left, right) => left.id.localeCompare(right.id));

export const unregisterProjectSignalProvider = (id: string) => providers.delete(id);
