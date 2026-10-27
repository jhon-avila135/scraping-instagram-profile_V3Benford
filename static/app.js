"use strict";

/* Dashboard logic: starts the three background jobs, follows their progress and renders the results. */

const $ = (id) => document.getElementById(id);

/* Create an element with properties and children. Text always goes in as text, never as HTML. */
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

const getJson = async (url) => (await fetch(url)).json();
const postJson = (url, body) => fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const link = (href, text, className = "") =>
  el("a", { href, target: "_blank", rel: "noopener noreferrer", textContent: text, className });
const chip = (text, tone = "") => el("span", { className: `chip ${tone}`.trim(), textContent: text });
const typeColor = (type) => ({ post: "var(--accent)", reel: "var(--accent-2)" })[type] ?? "var(--muted)";
const TRAIT_BY_KEY = Object.fromEntries(TRAITS.map((trait) => [trait.key, trait]));
const LEVEL_TONE = { high: "good", medium: "", low: "warn" };
const state = { posts: [], type: "all", query: "" };

const JOBS = {
  scrape: {
    status: "/api/status", button: "scrape-button", bar: "scrape-bar", text: "scrape-status", section: "overview",
    describe: (job) => job.stage
      ? `${{ posts: "Collecting posts", details: "Reading post details" }[job.stage]}: ${job.progress} of ${job.total}`
      : job.message || `Opening @${job.username}…`,
    done: (job) => `Finished scraping @${job.username}.`,
  },
  analysis: {
    status: "/api/analysis/status", button: "analysis-button", bar: "analysis-bar", text: "analysis-status", section: "personality",
    describe: (job) => `Asking Gemini: run ${Math.min(job.progress + 1, job.total)} of ${job.total}`,
    done: () => "Analysis finished.",
  },
  benford: {
    status: "/api/benford/status", button: "benford-button", bar: "benford-bar", text: "benford-status", section: "authenticity",
    describe: (job) => ({
      audience_list: `Listing accounts: ${job.progress} of ${job.total}`,
      audience: `Reading follower counts: ${job.progress} of ${job.total} usable accounts`,
    })[job.stage] || job.message || "Opening the profile…",
    done: () => "Benford check finished.",
  },
};

/* Show a status line under a form, in red when it is an error. */
function setStatus(id, message, isError = false) {
  $(id).textContent = message;
  $(id).classList.toggle("error", isError);
}

/* Lock or unlock a job's button and show its progress bar while it runs. */
function setBusy(config, busy) {
  $(config.button).disabled = busy;
  $(config.bar).hidden = !busy;
  if (busy) $(config.bar).removeAttribute("value");
}

/* Ask the server how a job is going every 1.5 seconds until it finishes, then refresh the page data. */
async function poll(name) {
  const config = JOBS[name];
  const job = await getJson(config.status);
  if (job.state === "running") {
    if (job.total) {
      $(config.bar).max = job.total;
      $(config.bar).value = job.progress;
    }
    setStatus(config.text, config.describe(job));
    setTimeout(() => poll(name), 1500);
    return;
  }
  setBusy(config, false);
  if (job.state === "error") return setStatus(config.text, job.error, true);
  setStatus(config.text, config.done(job));
  await loadResults();
  $(config.section).scrollIntoView({ behavior: "smooth" });
}

/* Send the request that starts a job and begin polling it, or show why the server refused. */
async function start(name, url, body) {
  const config = JOBS[name];
  setBusy(config, true);
  setStatus(config.text, "Starting…");
  try {
    const response = await postJson(url, body);
    if (!response.ok) {
      setBusy(config, false);
      return setStatus(config.text, (await response.json()).error, true);
    }
  } catch {
    setBusy(config, false);
    return setStatus(config.text, "The app is not reachable. Check that python app.py is still running.", true);
  }
  poll(name);
}

/* Fill the profile header: handle, biography and counters. */
function renderProfile(profile) {
  $("handle").textContent = `@${profile.username}`;
  $("bio").textContent = profile.biography || "No biography found.";
  const counts = [["followers", profile.followers], ["following", profile.following], ["posts", profile.posts_count]];
  $("counts").replaceChildren(...counts.filter(([, value]) => value)
    .map(([label, value]) => el("span", {}, el("strong", { textContent: value }), ` ${label}`)));
  $("meta").textContent = `Scraped ${new Date(profile.scraped_at).toLocaleString()}`;
}

/* Summarize likes and comments of the posts read in detail. */
function renderEngagement({ detailed, avg_likes, avg_comments, comments_read, top_url, top_likes }) {
  $("engagement-block").hidden = !detailed;
  if (!detailed) return;
  const parts = [
    avg_likes === null ? "likes are hidden" : `${avg_likes.toLocaleString()} likes on average`,
    avg_comments === null ? null : `${avg_comments.toLocaleString()} comments on average`,
    `${comments_read} comments read`,
  ].filter(Boolean);
  $("engagement").replaceChildren(
    `Across ${detailed} detailed posts: ${parts.join(", ")}.`,
    ...(top_url ? [" The most liked has ", link(top_url, `${top_likes.toLocaleString()} likes`), "."] : []),
  );
}

/* Draw the content mix, description coverage and most frequent words. */
function renderStats({ total, types, described, avg_description_length, top_words, engagement }) {
  renderEngagement(engagement);
  const entries = Object.entries(types);
  $("mix").replaceChildren(...entries.map(([type, count]) => el("span", { style: `flex:${count};background:${typeColor(type)}` })));
  $("mix-legend").textContent = entries.map(([type, count]) => `${count} ${type}s`).join(", ");
  $("coverage").textContent = `${described} of ${total} posts have a description, averaging ${avg_description_length} characters.`;

  const max = Math.max(1, ...top_words.map((item) => item.count));
  $("words").replaceChildren(...top_words.map(({ word, count }) => el("li", {},
    el("span", { textContent: word }),
    el("span", { className: "track" }, el("span", { className: "fill", style: `width:${(count / max) * 100}%` })),
    el("span", { className: "count", textContent: count }))));
}

/* Build the text block of one post, adding likes, date and comments when it was read in detail. */
function postBody(post) {
  const body = el("div", {}, el("p", {
    className: post.caption || post.description ? "" : "muted",
    textContent: post.caption || post.description || "No description",
  }));
  if (!("caption" in post)) return body;

  const metrics = [
    post.likes == null ? "likes hidden" : `${post.likes.toLocaleString()} likes`,
    post.comments_count == null ? null : `${post.comments_count.toLocaleString()} comments`,
    post.posted_at ? new Date(post.posted_at).toLocaleDateString() : null,
  ];
  body.append(el("p", { className: "metrics-line", textContent: metrics.filter(Boolean).join(", ") }));
  if (post.comments.length) {
    body.append(el("details", {},
      el("summary", { textContent: `${post.comments.length} comments read` }),
      el("ul", { className: "comments" }, ...post.comments.map((comment) =>
        el("li", {}, el("strong", { textContent: comment.author }), comment.text)))));
  }
  return body;
}

/* Render the post list after applying the type filter and the search box. */
function renderPosts() {
  const query = state.query.toLowerCase();
  const rows = state.posts.filter((post) =>
    (state.type === "all" || post.type === state.type) &&
    `${post.caption || ""} ${post.description}`.toLowerCase().includes(query));
  $("result-count").textContent = `Showing ${rows.length} of ${state.posts.length} posts`;
  $("post-list").replaceChildren(...rows.map((post) => el("li", {},
    el("span", { className: "type", textContent: post.type, style: `color:${typeColor(post.type)}` }),
    postBody(post),
    link(post.url, "Open post"))));
}

/* Create the "all / post / reel" filter buttons. */
function setupFilters(types) {
  const buttons = ["all", ...types].map((type) => {
    const button = el("button", { type: "button", textContent: type });
    button.setAttribute("aria-pressed", type === state.type);
    button.onclick = () => {
      state.type = type;
      buttons.forEach((other) => other.setAttribute("aria-pressed", other === button));
      renderPosts();
    };
    return button;
  });
  $("filters").replaceChildren(...buttons);
}

/* Build the card of one trait: score, per-run dots with their range, confidence, rationale and evidence. */
function traitCard(key, info, analysis, comparison) {
  const trait = TRAIT_BY_KEY[key];
  const runs = info.scores || [info.score];
  const low = Math.min(...runs), high = Math.max(...runs);
  const scale = el("div", { className: "scale", role: "img", ariaLabel: `${trait.label}: ${info.score.toFixed(1)} of 5` });
  if (runs.length > 1) {
    scale.append(el("span", { className: "band", style: `left:${position(low)}%;width:${position(high) - position(low)}%` }));
    runs.forEach((score, index) => scale.append(
      el("span", { className: "dot run", style: `left:${position(score)}%`, title: `Run ${index + 1}: ${score.toFixed(1)}` })));
  }
  const self = comparison ? comparison.traits[key].self : null;
  if (self) scale.append(el("span", { className: "dot self", style: `left:${position(self)}%`, title: `Self-report: ${self.toFixed(1)}` }));
  scale.append(el("span", { className: "dot ai", style: `left:${position(info.score)}%`, title: `Average: ${info.score.toFixed(1)}` }));

  const evidence = info.evidence.map((id) => analysis.sources[id]
    ? link(analysis.sources[id], id.replace("_", " "), "chip")
    : chip(id === "bio" ? "biography" : id));
  return el("article", { className: "card trait" },
    el("div", { className: "trait-head" },
      el("div", {}, el("h4", { textContent: trait.label }), el("p", { className: "muted", textContent: trait.meaning })),
      el("div", { className: "trait-score" },
        el("strong", { textContent: info.score.toFixed(1) }),
        el("span", { textContent: levelWord(info.score) }))),
    scale,
    el("div", { className: "scale-ends" },
      el("span", { textContent: "1 very low" }), el("span", { textContent: "3 average" }), el("span", { textContent: "5 very high" })),
    el("div", { className: "chips" },
      chip(`Confidence ${info.confidence}`, LEVEL_TONE[info.confidence]),
      info.consistency ? chip(`Consistency ${info.consistency}`, LEVEL_TONE[info.consistency]) : chip("Single run"),
      self ? chip(`Self-report ${self.toFixed(1)}`, "teal") : null),
    el("p", { className: "rationale", textContent: info.rationale }),
    el("div", { className: "evidence-row" },
      el("span", { className: "muted", textContent: "Evidence" }),
      ...(evidence.length ? evidence : [el("span", { className: "muted", textContent: "none cited" })])));
}

/* Fill the conclusion card: headline, strongest tendencies, narrative, caveat and what it rests on. */
function renderConclusion({ conclusion, dominant = [], traits, input, runs }) {
  $("conclusion").hidden = !conclusion;
  if (!conclusion) return;
  const lowConfidence = Object.values(traits).filter((info) => info.confidence === "low").length;
  $("conclusion-headline").textContent = conclusion.headline;
  $("conclusion-dominant").replaceChildren(...(dominant.length
    ? dominant.map(({ trait, level, score }) =>
      chip(`${level === "high" ? "High" : "Low"} ${TRAIT_BY_KEY[trait].label.toLowerCase()} ${score.toFixed(1)}`, level === "high" ? "accent" : "teal"))
    : [chip("No trait stands out from the average")]));
  $("conclusion-narrative").textContent = conclusion.narrative;
  $("conclusion-caveat").textContent = conclusion.caveat;
  $("conclusion-basis").replaceChildren(
    chip(`${input.posts} posts`),
    chip(`${input.comments} comments`),
    chip(`${runs} runs`),
    chip(`${lowConfidence} of 5 traits with low confidence`, lowConfidence >= 3 ? "warn" : ""));
}

/* Render the whole personality section: radar, conclusion, trait cards and the reasoning trail. */
function renderAnalysis(analysis, comparison) {
  $("analysis-result").hidden = !analysis;
  $("validation").hidden = !analysis;
  if (!analysis) return;

  const scores = (pick) => Object.fromEntries(TRAITS.map(({ key }) => [key, pick(key)]));
  $("radar").innerHTML = radarChart(
    scores((key) => analysis.traits[key].score),
    comparison ? scores((key) => comparison.traits[key].self) : null);
  $("radar-legend").replaceChildren(
    el("span", {}, el("span", { className: "swatch ai" }), "Gemini estimate"),
    ...(comparison ? [el("span", {}, el("span", { className: "swatch self" }), "Self-report (BFI-10)")] : []),
    el("span", { textContent: "Dashed ring: population average (3)" }));

  renderConclusion(analysis);
  $("trait-cards").replaceChildren(...TRAITS.map(({ key }) => traitCard(key, analysis.traits[key], analysis, comparison)));

  const { input } = analysis;
  const steps = [
    ["Collected", `${input.posts} posts and ${input.comments} comments${input.has_biography ? ", plus the biography" : ""}.`],
    ["Anonymized", "Username, links and display name removed before anything was sent."],
    ["Asked Gemini", `${analysis.runs} independent runs at a low temperature with ${analysis.model}.`],
    ["Checked and combined", "Answers validated against a schema, scores averaged, uncited evidence dropped."],
  ];
  $("trail").replaceChildren(...steps.map(([title, text]) => el("li", {}, el("strong", { textContent: title }), el("span", { textContent: text }))));
  $("analysis-meta").textContent = `Generated ${new Date(analysis.generated_at).toLocaleString()}.`;
  $("analysis-limits").textContent = analysis.limitations;
}

/* Create the ten BFI-10 statements with a 1 to 5 choice each, once. */
function setupQuestionnaire(items) {
  if ($("bfi-items").childElementCount) return;
  $("bfi-items").replaceChildren(...items.map((text, index) => el("li", {},
    el("p", { textContent: `I see myself as someone who ${text}.` }),
    el("div", { className: "likert" }, ...[1, 2, 3, 4, 5].map((value) =>
      el("label", {}, el("input", { type: "radio", name: `bfi${index}`, value: String(value), required: true }), String(value)))))));
}

/* Show the table that compares Gemini with the self-report. */
function renderComparison(comparison) {
  $("comparison").hidden = !comparison;
  if (!comparison) return;
  const signed = (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
  $("comparison").replaceChildren(
    el("table", { className: "compare" },
      el("thead", {}, el("tr", {}, ...["Trait", "Gemini", "Self-report", "Difference"].map((label) => el("th", { textContent: label })))),
      el("tbody", {}, ...TRAITS.map(({ key, label }) => [label, comparison.traits[key]]).map(([label, row]) => el("tr", {},
        el("td", { textContent: label }),
        el("td", { textContent: row.ai.toFixed(1) }),
        el("td", { textContent: row.self.toFixed(1) }),
        el("td", { textContent: signed(row.difference) }))))),
    el("p", { className: "big", textContent: `Average gap: ${comparison.mean_absolute_difference.toFixed(1)} points on the 1 to 5 scale.` }),
    el("p", { className: "meta", textContent: "The BFI-10 has only two items per trait, so it is a rough reference, not a ground truth." }));
}

/* Build one metric tile of the Benford section. */
function metric(label, value, hint) {
  return el("div", { className: "metric" },
    el("span", { className: "metric-label", textContent: label }),
    el("strong", { textContent: value }),
    el("span", { className: "metric-hint", textContent: hint }));
}

/* Render the Benford verdict, chart, metrics and digit table. */
function renderBenford(record) {
  $("benford-result").hidden = !record;
  if (!record) return;
  const result = record.analysis;
  $("benford-verdict").className = `card verdict ${{ consistent: "good", inconclusive: "warn", deviates: "bad" }[result.level]}`;
  $("benford-headline").textContent = result.headline;
  $("benford-explanation").textContent = result.explanation;
  $("benford-notes").hidden = !result.notes.length;
  $("benford-notes").replaceChildren(...result.notes.map((note) => el("li", { textContent: note })));
  $("benford-chart").innerHTML = benfordChart(result.digits);

  const percent = (value) => `${(value * 100).toFixed(1)}%`;
  $("benford-metrics").replaceChildren(
    metric("Accounts tested", String(result.sample), `with followers, of ${result.visited} visited`),
    metric("Chi-square p-value", result.p_value < 0.001 ? "< 0.001" : result.p_value.toFixed(3), "below 0.05 means a deviation"),
    metric("Mean deviation", `${(result.mad * 100).toFixed(1)} pts`, `about ${(result.mad_chance * 100).toFixed(1)} expected by chance`),
    metric("Magnitude span", `${result.span.toFixed(1)} orders`, "Benford needs at least 2"),
    metric("Zero followers", String(result.zeros), `${percent(result.zeros / result.visited)} of the visited accounts`));

  $("digit-table").replaceChildren(
    el("thead", {}, el("tr", {}, ...["Digit", "Accounts", "Observed", "Benford", "Gap"].map((label) => el("th", { textContent: label })))),
    el("tbody", {}, ...result.digits.map((row) => el("tr", {},
      el("td", { textContent: row.digit }),
      el("td", { textContent: row.count }),
      el("td", { textContent: percent(row.observed) }),
      el("td", { textContent: percent(row.expected) }),
      el("td", { textContent: `${row.observed >= row.expected ? "+" : ""}${((row.observed - row.expected) * 100).toFixed(1)} pts` })))));
  $("benford-meta").textContent = `Checked the ${record.list} of @${record.username}, ${new Date(record.generated_at).toLocaleString()}.`;
}

/* Load everything the server has saved and render every section. */
async function loadResults() {
  const { profile, posts, stats, analysis, comparison, benford, bfi10, audience_list } = await getJson("/api/data");
  $("results").hidden = !profile;
  $("empty").hidden = Boolean(profile);
  $("nav-links").hidden = !profile;
  if (!profile) return;

  Object.assign(state, { posts, type: "all", query: "" });
  $("search").value = "";
  renderProfile(profile);
  renderStats(stats);
  setupFilters(Object.keys(stats.types));
  renderPosts();
  renderAnalysis(analysis, comparison);
  setupQuestionnaire(bfi10);
  renderComparison(comparison);
  renderBenford(benford);
  $("benford-list").textContent = audience_list === "following" ? "accounts followed by" : "followers of";
  $("benford-profile").textContent = `@${profile.username}`;
  if (!stats.engagement.detailed) {
    setStatus("analysis-status", "Scrape at least one post in detail to enable the analysis.");
  }
}

$("scrape-form").onsubmit = (event) => {
  event.preventDefault();
  start("scrape", "/api/scrape", {
    username: $("username").value,
    posts: $("posts").value,
    details: $("details").value,
    headless: !$("show-browser").checked,
  });
};

$("analysis-form").onsubmit = (event) => {
  event.preventDefault();
  start("analysis", "/api/analyze", { consent: $("consent").checked, runs: $("runs").value });
};

$("benford-form").onsubmit = (event) => {
  event.preventDefault();
  start("benford", "/api/benford", {
    consent: $("benford-consent").checked,
    sample: $("benford-sample").value,
    headless: !$("show-browser").checked,
  });
};

$("bfi-form").onsubmit = async (event) => {
  event.preventDefault();
  const answers = Array.from({ length: 10 }, (_, index) =>
    Number(document.querySelector(`input[name="bfi${index}"]:checked`).value));
  const response = await postJson("/api/self-report", { answers });
  if (!response.ok) return setStatus("bfi-status", (await response.json()).error, true);
  setStatus("bfi-status", "Saved.");
  await loadResults();
};

$("search").oninput = (event) => {
  state.query = event.target.value;
  renderPosts();
};

(async () => {
  await loadResults();
  for (const name of Object.keys(JOBS)) {
    if ((await getJson(JOBS[name].status)).state === "running") {
      setBusy(JOBS[name], true);
      poll(name);
    }
  }
})();
