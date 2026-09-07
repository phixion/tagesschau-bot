import { test } from "vitest";
import assert from "node:assert/strict";
import {
  htmlToRedditMarkdown,
  renderEntryForReddit,
  resolvePostKind,
} from "../src/core/post-render.mjs";

test("htmlToRedditMarkdown converts common tags to markdown", () => {
  const html = `
    <![CDATA[
      <p>Hello <strong>world</strong>.</p>
      <p>See <a href="https://example.com/x">details</a><br/>next line.</p>
      <ul><li>One</li><li>Two</li></ul>
    ]]>
  `;

  const md = htmlToRedditMarkdown(html);
  assert.match(md, /Hello \*\*world\*\*\./);
  assert.match(md, /\[details\]\(https:\/\/example.com\/x\)/);
  assert.match(md, /- One/);
  assert.match(md, /- Two/);
});

test("renderEntryForReddit builds title and body", () => {
  const rendered = renderEntryForReddit(
    {
      title: "Patch Notes",
      url: "https://example.com/notes",
      descriptionHtml: "<p>Changes are available.</p>",
    },
    {
      postKind: "self",
      maxBodyChars: 1000,
    },
  );

  assert.equal(rendered.title, "Patch Notes");
  assert.equal(rendered.postKind, "self");
  assert.equal(
    rendered.bodyText,
    "Changes are available.\n\n[...zum Artikel](https://example.com/notes)",
  );
});

test("resolvePostKind defaults unsupported values to self", () => {
  assert.equal(resolvePostKind("link"), "link");
  assert.equal(resolvePostKind("self"), "self");
  assert.equal(resolvePostKind("weird"), "self");
});

test("renderEntryForReddit clips title to maxTitleChars", () => {
  const rendered = renderEntryForReddit(
    {
      title: "This title is intentionally very long for clipping verification",
      url: "https://example.com/notes",
      descriptionHtml: "<p>Body.</p>",
    },
    {
      postKind: "self",
      maxTitleChars: 30,
      maxBodyChars: 1000,
    },
  );

  assert.equal(rendered.title.length <= 30, true);
  assert.equal(rendered.title.endsWith("…"), true);
});

test("renderEntryForReddit uses the feed title without a prefix", () => {
  const renderedDefault = renderEntryForReddit({
    title: "Eilmeldung: Großbrand gelöscht",
    url: "https://www.tagesschau.de/eilmeldung",
  });
  assert.equal(renderedDefault.title, "Eilmeldung: Großbrand gelöscht");
});

test("renderEntryForReddit builds self-post body with text and article link below", () => {
  const rendered = renderEntryForReddit(
    {
      title: "Nachrichten",
      url: "https://www.tagesschau.de/inland/news",
      descriptionHtml: "<p>Hier ist die Beschreibung.</p>",
      imageUrl: "https://images.tagesschau.de/image/123/gross.jpg",
    },
    {
      postKind: "self",
    },
  );

  assert.equal(
    rendered.bodyText,
    "Hier ist die Beschreibung.\n\n[...zum Artikel](https://www.tagesschau.de/inland/news)",
  );
});
