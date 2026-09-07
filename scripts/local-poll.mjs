import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_MAX_DEDUPE,
  DEFAULT_MAX_POSTS_PER_RUN,
  applyPostedEntry,
  chooseEntriesToPost,
  hashText,
  parseState,
  serializeState,
} from "../src/core/bot-core.mjs";
import {
  renderEntryForReddit,
  resolvePostKind,
} from "../src/core/post-render.mjs";
import { parseFeedXml } from "../src/core/rss-parse.mjs";
import { parseFeedUrls } from "../src/core/schedule.mjs";
import { loadEnvFile } from "./load-env.mjs";
import {
  getDevvitAccessToken,
  submitRedditPost,
} from "./reddit-live-submit.mjs";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
const liveMode = flags.has("--live");
const dryRun = flags.has("--dry-run") || !liveMode;

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  if (isDevvitTokenError(message)) {
    console.error(
      'Auth tip: run "npx devvit login" to refresh ~/.devvit/token, or set DEVVIT_TOKEN_FILE.',
    );
  }
  process.exit(1);
});

async function main() {
  const envFile = process.env.ENV_FILE || ".env";
  loadEnvFile(envFile);

  const feedUrls = parseFeedUrls([
    getArgValues(argv, "--feed"),
    process.env.FEED_URLS,
  ]);
  const targetSubreddit = normalizeString(process.env.TARGET_SUBREDDIT);
  const stateFile = path.resolve(
    process.cwd(),
    normalizeString(process.env.STATE_FILE) || ".local-state.json",
  );
  const maxPostsPerRun = parsePositiveInt(
    process.env.MAX_POSTS_PER_RUN,
    DEFAULT_MAX_POSTS_PER_RUN,
  );
  const maxDedupeTrack = parsePositiveInt(
    process.env.MAX_DEDUPE_TRACK,
    DEFAULT_MAX_DEDUPE,
  );
  const postKind = resolvePostKind(process.env.POST_KIND);
  const maxBodyChars = parsePositiveInt(process.env.MAX_BODY_CHARS, 12000);

  if (feedUrls.length === 0 || !targetSubreddit) {
    throw new Error("FEED_URLS and TARGET_SUBREDDIT are required.");
  }

  const isMultiFeed = feedUrls.length > 1;

  let accessToken = "";
  let tokenType = "Bearer";
  if (!dryRun) {
    const session = getDevvitAccessToken({ env: process.env });
    accessToken = session.accessToken;
    tokenType = session.tokenType;
    console.log(`Using Devvit auth token from ${session.tokenFile}`);
    console.log(
      `Token expires at ${new Date(session.expiresAt).toISOString()}`,
    );
  }

  for (const feedUrl of feedUrls) {
    if (isMultiFeed) {
      console.log(`\n=== Polling feed: ${feedUrl} ===`);
    }
    const xml = await loadXml(feedUrl);
    const entries = parseFeedXml(xml);

    if (entries.length === 0) {
      console.log(`No entries parsed for ${feedUrl}.`);
      continue;
    }

    const state = readFeedState(stateFile, feedUrl, isMultiFeed);
    const selected = chooseEntriesToPost({
      entries,
      checkpoint: state.checkpoint,
      dedupe: state.dedupe,
      maxPostsPerRun,
    });

    if (selected.length === 0) {
      console.log(`No new entries to post for ${feedUrl}.`);
      continue;
    }

    let nextState = state;
    for (const item of selected) {
      const rendered = renderEntryForReddit(item.entry, {
        postKind,
        maxBodyChars,
      });

      if (dryRun) {
        console.log(`[DRY RUN] Would submit ${rendered.postKind} post`);
        console.log(`  title: ${rendered.title}`);
        console.log(`  url: ${rendered.sourceUrl || "(none)"}`);
        if (rendered.bodyText) {
          const preview =
            rendered.bodyText.length > 300
              ? `${rendered.bodyText.slice(0, 300)}...`
              : rendered.bodyText;
          console.log(`  body preview:\n${indentBlock(preview, "    ")}`);
        }
      } else {
        await submitRedditPost({
          accessToken,
          tokenType,
          subreddit: targetSubreddit,
          title: rendered.title,
          postKind: rendered.postKind,
          url: rendered.sourceUrl,
          text: rendered.bodyText,
          userAgent: String(process.env.REDDIT_USER_AGENT || ""),
        });
        console.log(`Submitted ${rendered.postKind}: "${rendered.title}"`);
      }

      nextState = applyPostedEntry(nextState, item, maxDedupeTrack);
    }

    writeFeedState(stateFile, feedUrl, nextState, isMultiFeed, maxDedupeTrack);
    console.log(`State updated for ${feedUrl} in: ${stateFile}`);
    console.log(
      `Checkpoint fingerprint: ${
        nextState.checkpoint?.fingerprint || "(none)"
      }`,
    );
  }
}

/**
 * @param {string} filePath
 * @param {string} feedUrl
 * @param {boolean} isMultiFeed
 */
function readFeedState(filePath, feedUrl, isMultiFeed) {
  if (!fs.existsSync(filePath)) {
    return { checkpoint: null, dedupe: [] };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (parsed.feeds && typeof parsed.feeds === "object") {
        const feedEntry =
          parsed.feeds[feedUrl] || parsed.feeds[hashText(feedUrl)];
        if (feedEntry) {
          return parseState(JSON.stringify(feedEntry));
        }
        return { checkpoint: null, dedupe: [] };
      }
      if (!isMultiFeed) {
        return parseState(raw);
      }
    }
  } catch {
    // fallback
  }
  return parseState(raw);
}

/**
 * @param {string} filePath
 * @param {string} feedUrl
 * @param {{ checkpoint: unknown; dedupe: string[] }} state
 * @param {boolean} isMultiFeed
 * @param {number} maxDedupeTrack
 */
function writeFeedState(filePath, feedUrl, state, isMultiFeed, maxDedupeTrack) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!isMultiFeed) {
    fs.writeFileSync(
      filePath,
      `${serializeState(state, maxDedupeTrack)}\n`,
      "utf8",
    );
    return;
  }

  let root = {};
  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (existing && typeof existing === "object") {
        root = existing.feeds ? existing : { feeds: {} };
      }
    } catch {
      root = {};
    }
  }
  if (!root.feeds || typeof root.feeds !== "object") {
    root.feeds = {};
  }
  root.feeds[feedUrl] = JSON.parse(serializeState(state, maxDedupeTrack));
  fs.writeFileSync(filePath, `${JSON.stringify(root, null, 2)}\n`, "utf8");
}

/**
 * @param {string} source
 * @returns {Promise<string>}
 */
async function loadXml(source) {
  if (source.startsWith("https://") || source.startsWith("http://")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Feed request failed (${response.status})`);
    }
    return response.text();
  }

  const filePath = path.resolve(process.cwd(), source);
  return fs.readFileSync(filePath, "utf8");
}

/**
 * @param {string} filePath
 */
function readStateFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { checkpoint: null, dedupe: [] };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return parseState(raw);
}

/**
 * @param {string} filePath
 * @param {{ checkpoint: unknown; dedupe: string[] }} state
 * @param {number} maxDedupeTrack
 */
function writeStateFile(filePath, state, maxDedupeTrack) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${serializeState(state, maxDedupeTrack)}\n`,
    "utf8",
  );
}

/**
 * @param {string[]} args
 * @param {string} flag
 * @returns {string[]}
 */
function getArgValues(args, flag) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[i + 1]);
    } else if (args[i].startsWith(`${flag}=`)) {
      values.push(args[i].slice(flag.length + 1));
    }
  }
  return values;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

/**
 * @param {string} value
 * @param {string} prefix
 * @returns {string}
 */
function indentBlock(value, prefix) {
  return String(value || "")
    .split(/\r?\n/g)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isDevvitTokenError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("devvit token") || text.includes("access token is expired")
  );
}
