import { registerProjectSignalProvider } from "../../scanner/providers.ts";
import type { ProjectSignalProvider } from "../../scanner/types.ts";

const backendProjectSignals: ProjectSignalProvider = {
  id: "backend",
  async detect(context) {
    const frameworks: ReturnType<typeof context.signal>[] = [];
    const tags = new Set<string>();
    const warnings: string[] = [];

    // Prisma detection
    const prismaFiles = await context.hasAnyFile(["prisma/schema.prisma"]);
    const prismaEvidence = [
      ...context.dependencyEvidence("prisma"),
      ...context.dependencyEvidence("@prisma/client"),
      ...prismaFiles,
    ];
    if (prismaEvidence.length > 0) {
      frameworks.push(context.signal("prisma", 0.96, prismaEvidence));
      tags.add("prisma");
      tags.add("backend");
      tags.add("persistence");
      tags.add("database");
      tags.add("postgresql");
      tags.add("nodejs");
    }

    // Drizzle detection
    const drizzleFiles = await context.hasAnyFile([
      "drizzle.config.ts",
      "drizzle.config.js",
      "drizzle.config.mjs",
      "drizzle.config.json",
    ]);
    const drizzleEvidence = [
      ...context.dependencyEvidence("drizzle-orm"),
      ...context.dependencyEvidence("drizzle-kit"),
      ...drizzleFiles,
    ];
    if (drizzleEvidence.length > 0) {
      frameworks.push(context.signal("drizzle", 0.94, drizzleEvidence));
      tags.add("drizzle");
      tags.add("backend");
      tags.add("persistence");
      tags.add("database");
      tags.add("nodejs");
    }

    // next-auth detection
    const authFiles = await context.hasAnyFile([
      "auth.ts",
      "auth.config.ts",
      "auth.config.js",
      "auth.config.mjs",
      "src/auth.ts",
      "src/auth.config.ts",
    ]);
    const authEvidence = [
      ...context.dependencyEvidence("next-auth"),
      ...context.dependencyEvidence("@auth/core"),
      ...authFiles,
    ];
    if (authEvidence.length > 0) {
      frameworks.push(context.signal("next-auth", 0.93, authEvidence));
      tags.add("next-auth");
      tags.add("auth");
      tags.add("backend");
      tags.add("nodejs");
    }

    // Generic backend framework detection for Node.js server
    const serverEvidence: string[] = [];
    const expressEvidence = context.dependencyEvidence("express");
    if (expressEvidence.length > 0) {
      frameworks.push(context.signal("express", 0.88, expressEvidence));
      tags.add("express");
      tags.add("backend");
      tags.add("nodejs");
      serverEvidence.push(...expressEvidence);
    }
    const nestEvidence = context.dependencyEvidence("@nestjs/core");
    if (nestEvidence.length > 0) {
      frameworks.push(context.signal("nestjs", 0.88, nestEvidence));
      tags.add("nestjs");
      tags.add("backend");
      tags.add("nodejs");
      serverEvidence.push(...nestEvidence);
    }
    const nodeVersion = context.dependencyVersion("next");
    // Next.js with backend signals already handled by frontend, but backend also cares about API routes
    const apiRouteFiles = await context.hasAnyFile([
      "app/api",
      "pages/api",
      "src/app/api",
      "src/pages/api",
    ]);
    if (apiRouteFiles.length > 0 && (tags.has("backend") || nodeVersion)) {
      tags.add("api");
      tags.add("route-handler");
      tags.add("server-action");
    }

    // If backend tags present, add generic backend project type
    const projectTypes: { type: string; confidence: number; evidence: string[] }[] = [];
    if (tags.has("backend")) {
      const evidence = [...prismaEvidence, ...drizzleEvidence, ...authEvidence, ...serverEvidence, ...apiRouteFiles];
      projectTypes.push({
        type: "backend",
        confidence: 0.94,
        evidence: evidence.length > 0 ? evidence.slice(0, 3) : ["backend signals"],
      });
      if (tags.has("prisma") || tags.has("drizzle")) {
        projectTypes.push({
          type: "persistence",
          confidence: 0.92,
          evidence: [...prismaEvidence, ...drizzleEvidence].slice(0, 3),
        });
      }
      if (tags.has("next-auth") || tags.has("auth")) {
        projectTypes.push({
          type: "auth",
          confidence: 0.90,
          evidence: authEvidence.slice(0, 3),
        });
      }
    }

    return {
      projectTypes,
      frameworks,
      tags: [...tags],
      warnings,
    };
  },
};

export const registerBackendProjectSignals = () =>
  registerProjectSignalProvider(backendProjectSignals);
