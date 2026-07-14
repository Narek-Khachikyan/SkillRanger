import type { ExampleScene } from "./example-types.ts";

const palette = {
  canvas: "#f5f3ee",
  surface: "#ffffff",
  text: "#18201d",
  muted: "#66716c",
  border: "#c9d0cc",
  accent: "#176b55",
  status: "#a2472f",
  bad: "#7d2d2d",
} as const;

const escapeXml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const fontSize = (emphasis: 1 | 2 | 3) => ({ 1: 16, 2: 22, 3: 34 })[emphasis];

export const renderExamplePlate = (scene: ExampleScene) => {
  const width = scene.viewport === "desktop" ? 1440 : 390;
  const height = scene.viewport === "desktop" ? 900 : 844;
  const margin = scene.viewport === "desktop" ? 72 : 24;
  const contentWidth = width - margin * 2;
  const headerHeight = scene.viewport === "desktop" ? 116 : 104;
  const blockHeight = scene.viewport === "desktop" ? 118 : 104;
  const gap = 18;
  const stateColor = scene.quality === "bad" ? palette.bad : palette.accent;
  const blocks = scene.blocks.map((block, index) => {
    const y = margin + headerHeight + index * (blockHeight + gap);
    const inset = 22 + (3 - block.emphasis) * 8;
    return [
      `<rect x="${margin}" y="${y}" width="${contentWidth}" height="${blockHeight}" rx="10" fill="${palette.surface}" stroke="${palette.border}"/>`,
      `<text x="${margin + inset}" y="${y + 42}" fill="${block.kind === "status" ? palette.status : palette.text}" font-family="system-ui, sans-serif" font-size="${fontSize(block.emphasis)}" font-weight="${block.emphasis === 3 ? 700 : 500}">${escapeXml(block.label)}</text>`,
      `<text x="${margin + inset}" y="${y + blockHeight - 20}" fill="${palette.muted}" font-family="system-ui, sans-serif" font-size="13">${escapeXml(block.kind)}</text>`,
    ].join("\n");
  }).join("\n");
  const footer = scene.quality === "bad"
    ? `<text x="${margin}" y="${height - 28}" fill="${palette.bad}" font-family="ui-monospace, monospace" font-size="12">${escapeXml(scene.violatedRuleIds.join(" · "))}</text>`
    : `<text x="${margin}" y="${height - 28}" fill="${palette.muted}" font-family="ui-monospace, monospace" font-size="12">${escapeXml(scene.appliedRuleIds.join(" · "))}</text>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">`,
    `<title id="title">${escapeXml(scene.title)}</title>`,
    `<desc id="description">${escapeXml(`${scene.quality} ${scene.viewport} ${scene.state} example`)}</desc>`,
    `<rect width="${width}" height="${height}" fill="${palette.canvas}"/>`,
    `<text x="${margin}" y="${margin + 18}" fill="${stateColor}" font-family="ui-monospace, monospace" font-size="14" font-weight="700">${escapeXml(scene.state.toUpperCase())}</text>`,
    `<text x="${margin}" y="${margin + 58}" fill="${palette.text}" font-family="system-ui, sans-serif" font-size="${scene.viewport === "desktop" ? 38 : 28}" font-weight="750">${escapeXml(scene.title)}</text>`,
    `<text x="${width - margin}" y="${margin + 18}" text-anchor="end" fill="${palette.accent}" font-family="system-ui, sans-serif" font-size="14" font-weight="700">${escapeXml(scene.primaryAction)}</text>`,
    blocks,
    footer,
    `</svg>`,
    "",
  ].join("\n");
};
