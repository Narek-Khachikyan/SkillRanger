export const frontendRecipeFiles = [
  "operational-command-center.json",
  "consumer-discovery.json",
  "developer-tool.json",
  "editorial-content.json",
  "marketing-landing.json",
  "saas-workspace.json",
  "e-commerce.json",
  "mobile-consumer-app.json",
] as const;

export const frontendRecipeIds = frontendRecipeFiles.map((file) => file.replace(/\.json$/, ""));
