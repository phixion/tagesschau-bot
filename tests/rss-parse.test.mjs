import fs from "node:fs";
import path from "node:path";
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseFeedXml } from "../src/core/rss-parse.mjs";

test("parseFeedXml parses sample RSS fixture", () => {
  const fixturePath = path.resolve(process.cwd(), "fixtures/sample-rss.xml");
  const xml = fs.readFileSync(fixturePath, "utf8");
  const entries = parseFeedXml(xml);

  assert.equal(entries.length, 3);
  assert.equal(entries[0].id, "post-one");
  assert.equal(entries[0].title, "Post One");
  assert.equal(entries[0].url, "https://example.com/post-one");
  assert.match(entries[0].descriptionHtml || "", /<strong>update<\/strong>/);
});

test("parseFeedXml parses Atom links with href attributes", () => {
  const atom = `
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>alpha</id>
        <title>Alpha Title</title>
        <updated>2026-02-15T13:00:00Z</updated>
        <link rel="alternate" href="https://example.com/alpha" />
      </entry>
    </feed>
  `;

  const entries = parseFeedXml(atom);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "alpha");
  assert.equal(entries[0].title, "Alpha Title");
  assert.equal(entries[0].url, "https://example.com/alpha");
  assert.equal(entries[0].descriptionHtml, undefined);
});

test("parseFeedXml extracts imageUrl from enclosure, media:content, and img tags", () => {
  const rss = `
    <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
      <channel>
        <item>
          <title>Item with enclosure</title>
          <link>https://www.tagesschau.de/item1</link>
          <enclosure url="https://images.tagesschau.de/img1.jpg" type="image/jpeg" />
          <description>Desc 1</description>
        </item>
        <item>
          <title>Item with media:content</title>
          <link>https://www.tagesschau.de/item2</link>
          <media:content url="https://images.tagesschau.de/img2.jpg" medium="image" />
          <description>Desc 2</description>
        </item>
        <item>
          <title>Item with img in description</title>
          <link>https://www.tagesschau.de/item3</link>
          <description>&lt;img src="https://images.tagesschau.de/img3.png" /&gt;Desc 3</description>
        </item>
      </channel>
    </rss>
  `;

  const entries = parseFeedXml(rss);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].imageUrl, "https://images.tagesschau.de/img1.jpg");
  assert.equal(entries[1].imageUrl, "https://images.tagesschau.de/img2.jpg");
  assert.equal(entries[2].imageUrl, "https://images.tagesschau.de/img3.png");
});
