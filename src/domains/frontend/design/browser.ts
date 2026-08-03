export type { BrowserObservationCapturePlan as BrowserObservationPlan } from "./evidence-plan.ts";
import { createBrowserObservationCapturePlan } from "./evidence-plan.ts";
import { executeBrowserObservationCapture } from "./evidence.ts";

// Keep the historical browser-observation exports stable while the canonical capture flow owns execution.
export const createBrowserObservationPlan = createBrowserObservationCapturePlan;
export const executeBrowserObservationPlan = executeBrowserObservationCapture;
