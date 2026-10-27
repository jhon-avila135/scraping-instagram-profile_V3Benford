"use strict";

/* Pure helpers that turn numbers into SVG markup. They never touch the DOM and only
   receive numbers and static labels, so their output is safe to assign to innerHTML. */

const TRAITS = [
  { key: "openness", label: "Openness", meaning: "Curiosity, imagination and appetite for new experiences." },
  { key: "conscientiousness", label: "Conscientiousness", meaning: "Organization, discipline and drive toward goals." },
  { key: "extraversion", label: "Extraversion", meaning: "Sociability, energy and assertiveness." },
  { key: "agreeableness", label: "Agreeableness", meaning: "Cooperation, trust and empathy." },
  { key: "neuroticism", label: "Neuroticism", meaning: "Tendency toward worry, stress and mood swings." },
];

const clampScore = (score) => Math.min(5, Math.max(1, score));
const position = (score) => ((clampScore(score) - 1) / 4) * 100;
const one = (value) => value.toFixed(1);

/* Turn a 1 to 5 score into a short word for the trait card. */
function levelWord(score) {
  if (score >= 4.2) return "High";
  if (score >= 3.6) return "Moderately high";
  if (score > 2.4) return "Around average";
  if (score > 1.8) return "Moderately low";
  return "Low";
}

/* Point at `radius` on spoke `index` of `total`, starting at the top and going clockwise. */
function polar(cx, cy, radius, index, total) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

/* Radar chart of the five traits on a 1 to 5 scale. `ai` and `self` map trait keys to scores. */
function radarChart(ai, self = null) {
  const cx = 210, cy = 200, outer = 128;
  const radius = (score) => (position(score) / 100) * outer;
  const points = (score) => TRAITS.map((_, index) => polar(cx, cy, radius(score(index)), index, TRAITS.length).map(one).join(",")).join(" ");
  const shape = (scores) => points((index) => scores[TRAITS[index].key]);

  const rings = [2, 3, 4, 5].map((level) =>
    `<polygon class="radar-ring${level === 3 ? " radar-avg" : ""}" points="${points(() => level)}"/>`).join("");
  const axes = TRAITS.map((_, index) => {
    const [x, y] = polar(cx, cy, outer, index, TRAITS.length);
    return `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${one(x)}" y2="${one(y)}"/>`;
  }).join("");
  const ticks = [2, 3, 4, 5].map((level) =>
    `<text class="radar-tick" x="${cx + 5}" y="${one(cy - radius(level) + 3)}">${level}</text>`).join("");
  const selfArea = self ? `<polygon class="radar-area-self" points="${shape(self)}"/>` : "";
  const dots = TRAITS.map((trait, index) => {
    const [x, y] = polar(cx, cy, radius(ai[trait.key]), index, TRAITS.length);
    return `<circle class="radar-dot" cx="${one(x)}" cy="${one(y)}" r="5"/>`;
  }).join("");
  const labels = TRAITS.map((trait, index) => {
    const [x, y] = polar(cx, cy, outer + 26, index, TRAITS.length);
    const side = Math.cos(-Math.PI / 2 + (index * 2 * Math.PI) / TRAITS.length);
    const anchor = Math.abs(side) < 0.25 ? "middle" : side > 0 ? "start" : "end";
    return `<text class="radar-label" x="${one(x)}" y="${one(y)}" text-anchor="${anchor}">${trait.label}` +
      `<tspan class="radar-value" x="${one(x)}" dy="1.25em">${one(ai[trait.key])}</tspan></text>`;
  }).join("");

  return `<svg viewBox="0 0 420 410" role="img" aria-label="Radar chart of the five trait scores on a scale from 1 to 5">` +
    `<title>Big Five scores</title>${rings}${axes}${ticks}${selfArea}<polygon class="radar-area-ai" points="${shape(ai)}"/>${dots}${labels}</svg>`;
}

/* Bars with the observed share of each first digit and a line with Benford's expected share. */
function benfordChart(digits) {
  const width = 560, height = 300, left = 46, right = 16, top = 26, bottom = 40;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const peak = Math.max(0.35, ...digits.map((row) => Math.max(row.observed, row.expected)));
  const ceiling = Math.ceil(peak * 20) / 20;
  const y = (value) => top + plotHeight - (value / ceiling) * plotHeight;
  const band = plotWidth / digits.length;
  const center = (index) => left + index * band + band / 2;

  const grid = [];
  for (let value = 0; value <= ceiling + 1e-9; value += 0.1) {
    grid.push(`<line class="grid-line" x1="${left}" y1="${one(y(value))}" x2="${width - right}" y2="${one(y(value))}"/>` +
      `<text class="axis-text" x="${left - 8}" y="${one(y(value) + 4)}" text-anchor="end">${Math.round(value * 100)}%</text>`);
  }
  const bars = digits.map((row, index) => {
    const barWidth = band * 0.56, barTop = y(row.observed);
    return `<rect class="bar" x="${one(center(index) - barWidth / 2)}" y="${one(barTop)}" width="${one(barWidth)}" height="${one(top + plotHeight - barTop)}" rx="4"/>` +
      `<text class="bar-label" x="${one(center(index))}" y="${one(barTop - 6)}" text-anchor="middle">${Math.round(row.observed * 100)}%</text>` +
      `<text class="axis-text" x="${one(center(index))}" y="${height - 16}" text-anchor="middle">${row.digit}</text>`;
  }).join("");
  const curve = digits.map((row, index) => `${one(center(index))},${one(y(row.expected))}`).join(" ");
  const curveDots = digits.map((row, index) => `<circle class="curve-dot" cx="${one(center(index))}" cy="${one(y(row.expected))}" r="4.5"/>`).join("");

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Share of follower counts by first digit compared with the Benford curve">` +
    `<title>First-digit distribution</title>${grid.join("")}${bars}<polyline class="curve" points="${curve}"/>${curveDots}</svg>`;
}

if (typeof module !== "undefined") {
  module.exports = { TRAITS, position, levelWord, radarChart, benfordChart };
}
