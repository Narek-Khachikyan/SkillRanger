import { registerProjectSignalProvider } from "../../scanner/providers.ts";
import type { ProjectSignalProvider } from "../../scanner/types.ts";

const frontendProjectSignals: ProjectSignalProvider = {
  id: "frontend",
  async detect(context) {
    const frameworks = [];
    const styling = [];
    const testing = [];
    const tags = new Set<string>();
    const warnings: string[] = [];

    const nextConfigs = await context.hasAnyFile([
      "next.config.js",
      "next.config.ts",
      "next.config.mjs",
    ]);
    if (context.dependencyVersion("next") || nextConfigs.length > 0) {
      frameworks.push(
        context.signal("nextjs", 0.96, [
          ...context.dependencyEvidence("next"),
          ...nextConfigs,
        ]),
      );
      tags.add("nextjs");
      tags.add("frontend");
      tags.add("web-app");
    }

    const viteConfigs = await context.hasAnyFile(["vite.config.js", "vite.config.ts"]);
    if (context.dependencyVersion("vite") || viteConfigs.length > 0) {
      frameworks.push(
        context.signal("vite", 0.9, [
          ...context.dependencyEvidence("vite"),
          ...viteConfigs,
        ]),
      );
      tags.add("vite");
      tags.add("frontend");
    }

    if (context.dependencyVersion("react")) {
      frameworks.push(
        context.signal("react", 0.98, context.dependencyEvidence("react")),
      );
      tags.add("react");
      tags.add("frontend");
    }

    const stylingConfigs = await context.hasAnyFile([
      "tailwind.config.js",
      "tailwind.config.ts",
      "postcss.config.js",
      "postcss.config.mjs",
    ]);
    if (context.dependencyVersion("tailwindcss") || stylingConfigs.length > 0) {
      styling.push(
        context.signal("tailwindcss", 0.88, [
          ...context.dependencyEvidence("tailwindcss"),
          ...(await context.hasAnyFile(["tailwind.config.js", "tailwind.config.ts"])),
        ]),
      );
      tags.add("tailwind");
    }

    const reactMajor = context.dependencyMajorVersion("react");
    if (reactMajor !== undefined && (reactMajor < 18 || reactMajor > 19)) {
      warnings.push(
        `React ${reactMajor} is outside the maintained frontend-skill range (18-19); use conservative fallbacks and do not promote without verification.`,
      );
    }
    const tailwindMajor = context.dependencyMajorVersion("tailwindcss");
    if (tailwindMajor !== undefined && (tailwindMajor < 3 || tailwindMajor > 4)) {
      warnings.push(
        `Tailwind CSS ${tailwindMajor} is outside the maintained frontend-skill range (3-4); use conservative fallbacks and do not promote without verification.`,
      );
    }

    for (const [name, outputName, type, confidence] of [
      ["playwright", "playwright", "e2e", 0.82],
      ["cypress", "cypress", "e2e", 0.76],
      ["@testing-library/react", "testing-library", "component", 0.74],
    ] as const) {
      const evidence = context.dependencyEvidence(name);
      if (name === "playwright") {
        evidence.push(...(await context.hasAnyFile(["playwright.config.ts", "playwright.config.js"])));
      }
      if (evidence.length > 0) {
        testing.push({ ...context.signal(outputName, confidence, evidence), type });
        tags.add("testing");
        if (name === "playwright") tags.add("playwright");
      }
    }

    if ((await context.hasAnyFile(["components"])).length > 0) {
      tags.add("component-design");
    }

    return {
      projectTypes: [
        ...(tags.has("frontend")
          ? [{ type: "frontend", confidence: 0.94, evidence: ["react/next/vite signals"] }]
          : []),
        ...(tags.has("web-app")
          ? [{ type: "web-app", confidence: 0.92, evidence: ["app/pages/package signals"] }]
          : []),
      ],
      frameworks,
      styling,
      testing,
      tags: [...tags],
      warnings,
    };
  },
};

export const registerFrontendProjectSignals = () =>
  registerProjectSignalProvider(frontendProjectSignals);
