import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DomainOwnershipRuleV10,
  DomainOwnershipRuleV11,
  DomainPackManifest,
  DomainRoutingMetadata,
} from "../../domains/types.ts";
import type { BundledRouterPack } from "../../domains/registry.ts";
import type { RouterFixturePack } from "../fixtures.ts";
import type { RoutingVocabularyFile } from "./types.ts";
import { routingVocabularyLimits } from "./validate.ts";

export type LoadedRouterPack = {
  domainId: string;
  routing: DomainRoutingMetadata;
  ownership: ReadonlyArray<DomainOwnershipRuleV10 | DomainOwnershipRuleV11>;
  vocabulary?: RoutingVocabularyFile;
  vocabularyBytes?: number;
};

const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export const loadDomainRoutingVocabulary = async (input: {
  root: string;
  manifest: DomainPackManifest;
}): Promise<{ vocabulary: RoutingVocabularyFile; bytes: number } | undefined> => {
  const relative = input.manifest.schemaVersion === "1.1" ? input.manifest.artifacts.routingVocabulary : undefined;
  if (!relative) return undefined;
  if (path.isAbsolute(relative) || relative.replace(/\\/gu, "/").split("/").includes("..")) {
    throw new Error("routing-vocabulary-path-invalid");
  }
  const canonicalRoot = await realpath(input.root).catch(() => { throw new Error("routing-vocabulary-path-invalid"); });
  const target = path.resolve(canonicalRoot, relative);
  const canonicalTarget = await realpath(target).catch(() => { throw new Error("routing-vocabulary-path-invalid"); });
  if (!inside(canonicalRoot, canonicalTarget)) throw new Error("routing-vocabulary-path-invalid");
  const metadata = await stat(canonicalTarget).catch(() => undefined);
  if (!metadata?.isFile()) throw new Error("routing-vocabulary-path-invalid");
  if (metadata.size > routingVocabularyLimits.maxFileBytes) throw new Error("routing-vocabulary-limit-exceeded");
  const bytes = await readFile(canonicalTarget);
  if (bytes.byteLength > routingVocabularyLimits.maxFileBytes) throw new Error("routing-vocabulary-limit-exceeded");
  let vocabulary: unknown;
  try { vocabulary = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("routing-vocabulary-invalid"); }
  return { vocabulary: vocabulary as RoutingVocabularyFile, bytes: bytes.byteLength };
};

export const loadBundledRoutingPacks = async (packs: BundledRouterPack[]): Promise<LoadedRouterPack[]> => Promise.all(
  packs.map(async (pack) => {
    const loaded = await loadDomainRoutingVocabulary({ root: pack.root, manifest: pack });
    return {
      domainId: pack.id,
      routing: pack.routing,
      ownership: pack.ownership,
      ...(loaded ? { vocabulary: loaded.vocabulary, vocabularyBytes: loaded.bytes } : {}),
    };
  }),
);

export const adaptFixtureRoutingPacks = (packs: RouterFixturePack[]): LoadedRouterPack[] => packs.map((pack) => ({
  domainId: pack.domain.id,
  routing: pack.domain.routing,
  ownership: pack.schemaVersion === "router-fixture-pack/1.1" ? pack.domain.ownership ?? [] : [],
  ...(pack.schemaVersion === "router-fixture-pack/1.1" && pack.vocabulary ? { vocabulary: pack.vocabulary } : {}),
}));

