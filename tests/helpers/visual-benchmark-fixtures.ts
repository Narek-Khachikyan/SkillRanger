export const visualCandidates = [
  { id: "weak", modelId: "provider/model-a@pinned", commandProfile: "weak.json" },
  { id: "medium", modelId: "provider/model-b@pinned", commandProfile: "medium.json" },
  { id: "strong", modelId: "provider/model-c@pinned", commandProfile: "strong.json" },
] as const;

export const makeMetrics = (overrides: Partial<{ sampleCount:number; meanQuality:number; catastrophicFailureRate:number; verificationSuccessRate:number; withinConditionVariance:number; meanRepairIterations:number; modelIds:string[] }> = {}) => ({
  benchmarkVersion:"visual-benchmark-v1",candidateId:"medium",sampleCount:16,meanQuality:.7,catastrophicFailureRate:.05,verificationSuccessRate:.85,withinConditionVariance:.08,meanRepairIterations:2,modelIds:["provider/model-b@pinned"],successfulRecipeIds:["developer-tool","saas-workspace"],evidencePaths:["results/report.json"],...overrides,
});
