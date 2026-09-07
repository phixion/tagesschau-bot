# tagesschau-bot

**tagesschau-bot** is a Reddit Devvit app that monitors official [Tagesschau](https://www.tagesschau.de) news feeds and automatically publishes German news articles, breaking updates, and topic reports directly to a subreddit.

It features persistent Redis-based checkpointing and deduplication to ensure that Tagesschau updates, article edits, or feed reordering never cause duplicate submissions.

## Key Features

- **Automated Tagesschau News Delivery**: Keep your community informed with the latest German and international news from tagesschau.de.
- **Flexible Post Formats**: Post as direct Reddit link posts (linking to tagesschau.de articles) or rich self-text posts with converted Markdown article summaries.
- **Selective Feeds**: Subscribe to any official Tagesschau feed—such as the main news feed, _Inland_, _Ausland_, _Wirtschaft_, _Investigativ_, or regional news.
- **Duplicate & Crash Protection**: Built-in fingerprinting and checkpoint history prevent duplicate posts, even if Tagesschau updates an article title or description.
- **Configurable Cadence & Safety**: Full control over polling intervals, maximum posts per cycle, title prefixes, and character limits.

## Setup (Moderators)

1. Install **tagesschau-bot**
1. Open the app's installation settings.
1. Configure the following options:
   - `feedUrl`: Tagesschau RSS feed URL to monitor (e.g. `https://www.tagesschau.de/xml/rss2_https/` or a specific topic feed).
   - `targetSubreddit`: Destination subreddit (or `u_<username>` for user profile posts).
   - `pollMinutes`: Polling schedule interval in minutes (`60` = hourly check).
   - `maxPostsPerRun`: Maximum number of news entries to post in one run (`1` to `3` recommended).
   - `postKind`: Post format — `link` (direct link to Tagesschau) or `self` (text post with summary).
   - `titlePrefix`: Prefix for Reddit post titles (e.g. `[Tagesschau] ` or `[Nachrichten] `).
   - `maxBodyChars`: Maximum character length for self-post bodies before truncation.
   - `maxDedupeTrack`: Number of recent post fingerprints retained to prevent duplicates (default `500`).
1. Save settings and wait for the first scheduled run.

## Popular Tagesschau Feeds

Choose an official feed URL to paste into `feedUrl`:

- **Main News Feed**: `https://www.tagesschau.de/xml/rss2_https/`
- **Inland**: `https://www.tagesschau.de/inland/index~rss2.xml`
- **Ausland**: `https://www.tagesschau.de/ausland/index~rss2.xml`
- **Wirtschaft**: `https://www.tagesschau.de/wirtschaft/index~rss2.xml`
- **Investigativ**: `https://www.tagesschau.de/investigativ/index~rss2.xml`
- **Eilmeldung**: `https://www.tagesschau.de/infoservices/eilmeldungen-100~rss2.xml`
- More feeds and regional editions: [Tagesschau RSS-Feeds Übersicht](https://www.tagesschau.de/infoservices/rssfeeds)

## Posting Behavior

- **Safe Initialization**: On its first run, the bot only posts the newest entries up to `maxPostsPerRun` rather than flooding the subreddit with historical archives.
- **Crash Safety**: Checkpoints are updated atomically after each successful submission.
- **Reddit Limits**: Post titles and bodies are automatically sanitized and clipped within Reddit limits.
- **Markdown Conversion**: HTML descriptions in the feed are parsed and converted to clean Reddit Markdown for self posts.

## Fetch Domains

The following domains are requested for this app:

- `www.tagesschau.de` - Used to fetch public RSS news feeds from Tagesschau (tagesschau.de) to create link/self posts on Reddit.

This list must stay in sync with the `http.domains` array in [`devvit.json`](./devvit.json).

## Public API / Feeds Documentation

- Tagesschau public RSS feeds — [`infoservices/rssfeeds`](https://www.tagesschau.de/infoservices/rssfeeds)
- bundesAPI tagesschau-api repository — [`bundesAPI/tagesschau-api`](https://github.com/bundesAPI/tagesschau-api)
- bundesAPI tagesschau-api documentation — [`tagesschau.api.bund.dev`](https://tagesschau.api.bund.dev)

## Developer Documentation

The technical and developer documentation is located in [DEVELOPER.md](./DEVELOPER.md).
