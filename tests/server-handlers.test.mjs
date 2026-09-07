import { beforeEach, expect, test, vi } from "vitest";
import { hashText } from "../src/core/bot-core.mjs";
import { buildPollingCron } from "../src/core/schedule.mjs";

const FEED_URL = "https://example.com/feed.xml";
const TARGET_SUBREDDIT = "ExampleSubreddit";

const RSS_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>Item One</title>
      <link>https://example.com/item-one</link>
      <guid>item-1</guid>
      <pubDate>Tue, 17 Feb 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[
        <p>Hello <strong>world</strong>.</p>
        <p>Read <a href="https://example.com/item-one">more</a>.</p>
      ]]></description>
    </item>
  </channel>
</rss>`;

// Shared mutable test doubles for the mocked `@devvit/*` server packages.
// Hoisted so they are initialized before the module factories run.
const harness = vi.hoisted(() => ({
  /** @type {Record<string, unknown>} */
  settingsValues: {},
  /** @type {Map<string, string>} */
  redisStore: new Map(),
  submitPost: vi.fn(),
  runJob: vi.fn(),
}));

vi.mock("@devvit/settings", () => ({
  settings: {
    get: async (key) => harness.settingsValues[key],
    getAll: async () => harness.settingsValues,
  },
}));

vi.mock("@devvit/redis", () => ({
  redis: {
    get: async (key) =>
      harness.redisStore.has(key) ? harness.redisStore.get(key) : undefined,
    set: async (key, value) => {
      harness.redisStore.set(key, value);
    },
  },
}));

vi.mock("@devvit/reddit", () => ({
  reddit: {
    submitPost: harness.submitPost,
  },
}));

vi.mock("@devvit/scheduler", () => ({
  scheduler: {
    runJob: harness.runJob,
  },
}));

const { runPollJob, schedulePollingJob, JOB_NAME } = await import(
  "../src/server/handlers.mjs"
);

beforeEach(() => {
  harness.settingsValues = {
    feedUrls: FEED_URL,
    targetSubreddit: TARGET_SUBREDDIT,
    pollMinutes: 15,
    maxPostsPerRun: 1,
    maxDedupeTrack: 50,
    postKind: "self",
    maxBodyChars: 12000,
  };
  harness.redisStore.clear();
  harness.submitPost.mockReset();
  harness.submitPost.mockResolvedValue({
    id: "t3_test",
    url: "https://reddit.com/test",
  });
  harness.runJob.mockReset();
  harness.runJob.mockResolvedValue("scheduled-job-id");
  vi.restoreAllMocks();
});

test("buildPollingCron maps minutes to a cron expression", () => {
  expect(buildPollingCron(15)).toBe("*/15 * * * *");
  expect(buildPollingCron(60)).toBe("0 * * * *");
});

test("runPollJob posts a new entry once and is idempotent on rerun", async () => {
  // Fresh Response per call: a Response body can only be read once.
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(RSS_XML, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      }),
  );

  await runPollJob();

  expect(harness.submitPost).toHaveBeenCalledTimes(1);
  const submitArgs = harness.submitPost.mock.calls[0][0];
  expect(submitArgs.subredditName).toBe(TARGET_SUBREDDIT);
  expect(submitArgs.title).toBe("Item One");
  expect(submitArgs.url).toBeUndefined();
  expect(submitArgs.text).toContain(
    "[...zum Artikel](https://example.com/item-one)",
  );
  expect(submitArgs.text).toContain("Hello **world**.");

  const stateKey = `rss:state:${TARGET_SUBREDDIT}:${hashText(FEED_URL).slice(
    0,
    16,
  )}`;
  const stateRaw = harness.redisStore.get(stateKey);
  expect(stateRaw).toBeTruthy();
  expect(JSON.parse(stateRaw)?.checkpoint?.fingerprint).toBe("item-1");

  // Re-running with the same feed must not submit the entry again.
  await runPollJob();
  expect(harness.submitPost).toHaveBeenCalledTimes(1);
});

test("runPollJob submits a link post when postKind is link", async () => {
  harness.settingsValues.postKind = "link";
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(RSS_XML, { status: 200 }),
  );

  await runPollJob();

  expect(harness.submitPost).toHaveBeenCalledTimes(1);
  const submitArgs = harness.submitPost.mock.calls[0][0];
  expect(submitArgs.url).toBe("https://example.com/item-one");
  expect(submitArgs.text).toBeUndefined();
});

test("runPollJob skips when feedUrls or targetSubreddit is missing", async () => {
  harness.settingsValues.targetSubreddit = "";
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  await runPollJob();

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(harness.submitPost).not.toHaveBeenCalled();
});

test("schedulePollingJob registers a recurring cron plus a warm-up run", async () => {
  harness.settingsValues.pollMinutes = 15;

  await schedulePollingJob();

  expect(harness.runJob).toHaveBeenCalledTimes(2);
  const [cronJob, warmupJob] = harness.runJob.mock.calls.map((call) => call[0]);
  expect(cronJob).toEqual({ name: JOB_NAME, cron: "*/15 * * * *" });
  expect(warmupJob.name).toBe(JOB_NAME);
  expect(warmupJob.runAt).toBeInstanceOf(Date);
});

test("runPollJob polls multiple configured feeds independently", async () => {
  const feed1 = "https://www.tagesschau.de/inland/index~rss2.xml";
  const feed2 = "https://www.tagesschau.de/ausland/index~rss2.xml";

  const xmlFeed1 = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Inland Feed</title>
    <item>
      <title>Inland News 1</title>
      <link>https://www.tagesschau.de/inland/news-1</link>
      <guid>inland-1</guid>
      <pubDate>Tue, 17 Feb 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[Inland report text.]]></description>
    </item>
  </channel>
</rss>`;

  const xmlFeed2 = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Ausland Feed</title>
    <item>
      <title>Ausland News 1</title>
      <link>https://www.tagesschau.de/ausland/news-1</link>
      <guid>ausland-1</guid>
      <pubDate>Tue, 17 Feb 2026 11:00:00 GMT</pubDate>
      <description><![CDATA[Ausland report text.]]></description>
    </item>
  </channel>
</rss>`;

  harness.settingsValues = {
    feedUrls: `${feed1}\n${feed2}`,
    targetSubreddit: TARGET_SUBREDDIT,
    pollMinutes: 15,
    maxPostsPerRun: 1,
    maxDedupeTrack: 50,
    postKind: "self",
    maxBodyChars: 12000,
  };

  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (url === feed1) {
      return new Response(xmlFeed1, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    }
    if (url === feed2) {
      return new Response(xmlFeed2, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    }
    return new Response("", { status: 404 });
  });

  await runPollJob();

  expect(harness.submitPost).toHaveBeenCalledTimes(2);
  expect(harness.submitPost.mock.calls[0][0].title).toBe("Inland News 1");
  expect(harness.submitPost.mock.calls[1][0].title).toBe("Ausland News 1");

  const stateKey1 = `rss:state:${TARGET_SUBREDDIT}:${hashText(feed1).slice(
    0,
    16,
  )}`;
  const stateKey2 = `rss:state:${TARGET_SUBREDDIT}:${hashText(feed2).slice(
    0,
    16,
  )}`;
  expect(
    JSON.parse(harness.redisStore.get(stateKey1))?.checkpoint?.fingerprint,
  ).toBe("inland-1");
  expect(
    JSON.parse(harness.redisStore.get(stateKey2))?.checkpoint?.fingerprint,
  ).toBe("ausland-1");
});

test("runPollJob continues with remaining feeds if one feed request fails", async () => {
  const feedFail = "https://www.tagesschau.de/broken/index~rss2.xml";
  const feedGood = "https://www.tagesschau.de/inland/index~rss2.xml";

  harness.settingsValues = {
    feedUrls: `${feedFail}\n${feedGood}`,
    targetSubreddit: TARGET_SUBREDDIT,
    pollMinutes: 15,
    maxPostsPerRun: 1,
    maxDedupeTrack: 50,
    postKind: "self",
    maxBodyChars: 12000,
  };

  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (url === feedFail) {
      return new Response("Internal Server Error", { status: 500 });
    }
    return new Response(RSS_XML, {
      status: 200,
      headers: { "content-type": "application/rss+xml" },
    });
  });

  await runPollJob();

  // The good feed should still have been processed and posted
  expect(harness.submitPost).toHaveBeenCalledTimes(1);
  expect(harness.submitPost.mock.calls[0][0].title).toBe("Item One");
});
