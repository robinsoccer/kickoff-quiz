/**
 * KickOff Quiz — Daily Agent
 * Runs every morning via GitHub Actions:
 *   1. Fetches soccer headlines via Claude + web search
 *   2. Generates quiz questions from those headlines
 *   3. Sends the digest email via Gmail MCP
 *   4. Saves quiz JSON to ./output/daily_quiz.json
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  email: process.env.DIGEST_EMAIL || "mmrastad@gmail.com",
  leagues: ["Premier League", "Ligue 1", "Bundesliga", "La Liga", "Serie A"],
  leagueFlags: {
    "Premier League": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "Ligue 1": "🇫🇷",
    Bundesliga: "🇩🇪",
    "La Liga": "🇪🇸",
    "Serie A": "🇮🇹",
  },
  numQuestions: 8,
  quizDifficulty: "medium",
  outputDir: path.join(__dirname, "..", "output"),
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── HELPERS ───────────────────────────────────────────────────────────────────
function today() {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

function extractJson(text) {
  // Strip markdown fences if present
  const clean = text.replace(/```json|```/g, "").trim();
  const match = clean.match(/[\[{][\s\S]*[\]}]/);
  if (!match) throw new Error("No JSON found in response");
  return JSON.parse(match[0]);
}

// ── STEP 1: FETCH HEADLINES ───────────────────────────────────────────────────
async function fetchHeadlines() {
  log("📰", "Fetching today's soccer headlines via web search…");

  const prompt = `You are a soccer news agent. Today is ${today()}.

Search the web for the LATEST soccer headlines for these leagues: ${CONFIG.leagues.join(", ")}.
For each league, find 3-4 real, current top news headlines (transfers, match results, injuries, manager news, etc.).

Respond ONLY with a JSON object — no markdown, no extra text:
{
  "date": "${today()}",
  "leagues": [
    {
      "name": "Premier League",
      "flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
      "headlines": ["Headline 1", "Headline 2", "Headline 3"]
    }
  ]
}

Include ALL five leagues: ${CONFIG.leagues.join(", ")}.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: prompt }],
  });

  const textBlocks = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const data = extractJson(textBlocks);
  log("✅", `Headlines fetched for ${data.leagues.length} leagues`);
  return data;
}

// ── STEP 2: GENERATE QUIZ ─────────────────────────────────────────────────────
async function generateQuiz(newsData) {
  log("🧠", `Generating ${CONFIG.numQuestions} quiz questions…`);

  const headlineText = newsData.leagues
    .map(
      (l) =>
        `${l.flag} ${l.name}:\n${l.headlines.map((h) => `  • ${h}`).join("\n")}`
    )
    .join("\n\n");

  const diffMap = {
    easy: "Make questions straightforward — obvious facts from the headlines. Wrong choices should be clearly different.",
    medium:
      "Moderately challenging — require careful reading. Wrong choices should be plausible but wrong to an attentive reader.",
    hard: "Tricky — ask about specific details, numbers, names. Wrong choices should be very close to the correct answer.",
  };

  const prompt = `You are a soccer quiz generator. Given these headlines, create exactly ${CONFIG.numQuestions} multiple choice questions.

Headlines:
${headlineText}

Difficulty: ${CONFIG.quizDifficulty}. ${diffMap[CONFIG.quizDifficulty]}

Rules:
- Each question must have exactly 3 choices: A, B, C
- Exactly one choice is correct
- Questions must be based ONLY on the headlines provided
- Mix questions across all leagues
- Make questions engaging and specific

Respond ONLY with a valid JSON array — no markdown, no preamble:
[
  {
    "question": "Question text here?",
    "league": "Premier League",
    "flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "choices": [
      {"letter": "A", "text": "Choice A", "correct": false},
      {"letter": "B", "text": "Choice B", "correct": true},
      {"letter": "C", "text": "Choice C", "correct": false}
    ]
  }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const questions = extractJson(text);
  log("✅", `${questions.length} quiz questions generated`);
  return questions;
}

// ── STEP 3: SEND EMAIL ────────────────────────────────────────────────────────
async function sendDigestEmail(newsData) {
  log("📧", `Sending digest email to ${CONFIG.email}…`);

  const body = [
    `⚽ Daily Soccer Headlines — ${newsData.date}`,
    "",
    ...newsData.leagues.flatMap((l) => [
      `${l.flag} ${l.name.toUpperCase()}`,
      ...l.headlines.map((h) => `  • ${h}`),
      "",
    ]),
    "---",
    "Delivered by your KickOff Quiz Soccer Agent via Claude AI",
  ].join("\n");

  const prompt = `Send an email using Gmail with exactly these details:
To: ${CONFIG.email}
Subject: ⚽ Daily Soccer Headlines — ${newsData.date}
Body:
${body}

Send it now.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    mcp_servers: [
      {
        type: "url",
        url: "https://gmailmcp.googleapis.com/mcp/v1",
        name: "gmail-mcp",
      },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const sent =
    response.content.some((b) => b.type === "mcp_tool_result") ||
    response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .toLowerCase()
      .match(/sent|success|delivered/);

  if (sent) {
    log("✅", "Digest email sent successfully");
  } else {
    log("⚠️", "Email may not have sent — check Gmail MCP auth");
  }
}

// ── STEP 4: SAVE OUTPUT ───────────────────────────────────────────────────────
function saveOutput(newsData, questions) {
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  const dateStamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Save today's quiz (website reads this)
  const quizPayload = {
    date: newsData.date,
    dateStamp,
    generatedAt: new Date().toISOString(),
    questions,
  };
  fs.writeFileSync(
    path.join(CONFIG.outputDir, "daily_quiz.json"),
    JSON.stringify(quizPayload, null, 2)
  );

  // Save headlines
  fs.writeFileSync(
    path.join(CONFIG.outputDir, "daily_headlines.json"),
    JSON.stringify(newsData, null, 2)
  );

  // Archive with date stamp
  fs.writeFileSync(
    path.join(CONFIG.outputDir, `quiz_${dateStamp}.json`),
    JSON.stringify(quizPayload, null, 2)
  );

  log("✅", `Output saved to /output/daily_quiz.json (+ archive: quiz_${dateStamp}.json)`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🚀 KickOff Quiz Daily Agent starting…");
  console.log(`📅 Date: ${today()}`);
  console.log("─".repeat(50));

  try {
    // Step 1: Fetch headlines
    const newsData = await fetchHeadlines();

    // Step 2: Generate quiz in parallel with email send
    const [questions] = await Promise.all([
      generateQuiz(newsData),
      sendDigestEmail(newsData),
    ]);

    // Step 3: Save outputs
    saveOutput(newsData, questions);

    console.log("─".repeat(50));
    console.log("🏆 All done! Daily agent completed successfully.\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Agent failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
