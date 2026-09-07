import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_MAX_DEDUPE,
  DEFAULT_MAX_POSTS_PER_RUN,
  chooseEntriesToPost,
  fingerprintEntry,
  hashText,
  parseState,
} from "../src/core/bot-core.mjs";
import {
  renderEntryForReddit,
  resolvePostKind,
} from "../src/core/post-render.mjs";
import { parseFeedXml } from "../src/core/rss-parse.mjs";
import { parseFeedUrls } from "../src/core/schedule.mjs";
import { loadEnvFile } from "./load-env.mjs";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
const jsonOutput = flags.has("--json");

const envFile = getArgValue(argv, "--env") || process.env.ENV_FILE || ".env";
loadEnvFile(envFile);

const feedUrls = parseFeedUrls([
  getArgValues(argv, "--feed"),
  process.env.FEED_URLS,
]);
const targetSubreddit =
  normalizeString(process.env.TARGET_SUBREDDIT) || "(unset)";
const stateFile = path.resolve(
  process.cwd(),
  normalizeString(getArgValue(argv, "--state") || process.env.STATE_FILE) ||
    ".local-state.json",
);
const maxPostsPerRun = parsePositiveInt(
  getArgValue(argv, "--max-posts") || process.env.MAX_POSTS_PER_RUN,
  DEFAULT_MAX_POSTS_PER_RUN,
);
const maxDedupeTrack = parsePositiveInt(
  process.env.MAX_DEDUPE_TRACK,
  DEFAULT_MAX_DEDUPE,
);
const postKind = resolvePostKind(
  getArgValue(argv, "--post-kind") || process.env.POST_KIND,
);
const maxBodyChars = parsePositiveInt(
  getArgValue(argv, "--max-body-chars") || process.env.MAX_BODY_CHARS,
  12000,
);

if (feedUrls.length === 0) {
  console.error(
    "Missing FEED_URLS. Set it in env or pass --feed <path-or-url>.",
  );
  process.exit(1);
}

const isMultiFeed = feedUrls.length > 1;

const feedPlans = [];

for (const feedUrl of feedUrls) {
  const state = readFeedState(stateFile, feedUrl, isMultiFeed);
  const xml = await loadXml(feedUrl);
  const entries = parseFeedXml(xml);
  const selected = chooseEntriesToPost({
    entries,
    checkpoint: state.checkpoint,
    dedupe: state.dedupe,
    maxPostsPerRun,
  });

  const plan = selected.map((item, index) => {
    const rendered = renderEntryForReddit(item.entry, {
      postKind,
      maxBodyChars,
    });
    return {
      index: index + 1,
      postKind: rendered.postKind,
      explicitTitle: rendered.title,
      bodyText: rendered.bodyText,
      sourceUrl: rendered.sourceUrl || null,
      originalTitle: item.entry.title,
      id: item.entry.id || null,
      publishedAt: item.entry.publishedAt || null,
      fingerprint: item.fingerprint || fingerprintEntry(item.entry),
    };
  });

  feedPlans.push({
    feedUrl,
    entriesCount: entries.length,
    checkpoint: state.checkpoint,
    dedupeCount: state.dedupe.length,
    plan,
  });
}

if (jsonOutput) {
  if (!isMultiFeed) {
    const single = feedPlans[0];
    console.log(
      JSON.stringify(
        {
          feedUrl: single.feedUrl,
          targetSubreddit,
          stateFile,
          maxPostsPerRun,
          maxDedupeTrack,
          postKind,
          maxBodyChars,
          parsedEntries: single.entriesCount,
          checkpoint: single.checkpoint,
          dedupeCount: single.dedupeCount,
          willPostCount: single.plan.length,
          willPost: single.plan,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      JSON.stringify(
        {
          feedUrls,
          targetSubreddit,
          stateFile,
          maxPostsPerRun,
          maxDedupeTrack,
          postKind,
          maxBodyChars,
          totalWillPost: feedPlans.reduce((sum, f) => sum + f.plan.length, 0),
          feeds: feedPlans.map((f) => ({
            feedUrl: f.feedUrl,
            parsedEntries: f.entriesCount,
            checkpoint: f.checkpoint,
            dedupeCount: f.dedupeCount,
            willPostCount: f.plan.length,
            willPost: f.plan,
          })),
        },
        null,
        2,
      ),
    );
  }
  process.exit(0);
}

if (!isMultiFeed) {
  const single = feedPlans[0];
  console.log(`Feed source: ${single.feedUrl}`);
  console.log(`Target subreddit: ${targetSubreddit}`);
  console.log(`State file: ${stateFile}`);
  console.log(`Entries parsed: ${single.entriesCount}`);
  console.log(`Checkpoint: ${single.checkpoint?.fingerprint || "(none)"}`);
  console.log(`Dedupe entries tracked: ${single.dedupeCount}`);
  console.log(`Max posts per run: ${maxPostsPerRun}`);
  console.log(`Post kind: ${postKind}`);
  console.log(`Max body chars: ${maxBodyChars}`);
  console.log(`Will post: ${single.plan.length}`);

  if (single.plan.length === 0) {
    console.log("No new entries would be posted.");
  } else {
    for (const post of single.plan) {
      console.log("");
      console.log(`#${post.index}`);
      console.log(`  title: ${post.explicitTitle}`);
      console.log(`  sourceUrl: ${post.sourceUrl || "(none)"}`);
      console.log(`  postKind: ${post.postKind}`);
      console.log(`  id: ${post.id || "(none)"}`);
      console.log(`  publishedAt: ${post.publishedAt || "(none)"}`);
      console.log(`  fingerprint: ${post.fingerprint}`);
      console.log("  bodyText:");
      console.log(indentBlock(post.bodyText || "(empty)", "    "));
    }
  }
} else {
  console.log(`Feeds monitored: ${feedUrls.length}`);
  console.log(`Target subreddit: ${targetSubreddit}`);
  console.log(`State file: ${stateFile}`);
  console.log(`Max posts per run: ${maxPostsPerRun}`);
  console.log(`Post kind: ${postKind}`);
  console.log(`Max body chars: ${maxBodyChars}`);

  let totalWillPost = 0;
  for (const f of feedPlans) {
    totalWillPost += f.plan.length;
    console.log(`\n=== Feed: ${f.feedUrl} ===`);
    console.log(`  Entries parsed: ${f.entriesCount}`);
    console.log(`  Checkpoint: ${f.checkpoint?.fingerprint || "(none)"}`);
    console.log(`  Dedupe tracked: ${f.dedupeCount}`);
    console.log(`  Will post: ${f.plan.length}`);

    for (const post of f.plan) {
      console.log("");
      console.log(`  #${post.index}`);
      console.log(`    title: ${post.explicitTitle}`);
      console.log(`    sourceUrl: ${post.sourceUrl || "(none)"}`);
      console.log(`    postKind: ${post.postKind}`);
      console.log(`    fingerprint: ${post.fingerprint}`);
      if (post.bodyText) {
        console.log("    bodyText:");
        console.log(indentBlock(post.bodyText, "      "));
      }
    }
  }
  console.log(`\nTotal posts that would be submitted: ${totalWillPost}`);
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
 */
function readStateFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { checkpoint: null, dedupe: [] };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return parseState(raw);
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
 * @param {string[]} args
 * @param {string} name
 * @returns {string}
 */
function getArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) {
    return "";
  }
  return String(args[idx + 1]);
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
