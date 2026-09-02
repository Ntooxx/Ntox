import { describe, it, expect } from "vitest";
import { diagnoseFetchedContent, extractHtmlTitle, htmlToBasicMarkdown, htmlToReadableMarkdown, webFetchTool } from "./web.js";

describe("webFetchTool — URL validation", () => {
  it("blocks file:// protocol", async () => {
    const r = await webFetchTool.execute({ url: "file:///etc/passwd" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked protocol");
  });

  it("blocks localhost", async () => {
    const r = await webFetchTool.execute({ url: "http://localhost:8080/admin" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks 127.0.0.1", async () => {
    const r = await webFetchTool.execute({ url: "http://127.0.0.1:3000" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks private 10.x range", async () => {
    const r = await webFetchTool.execute({ url: "http://10.0.0.1/api" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks 192.168.x range", async () => {
    const r = await webFetchTool.execute({ url: "http://192.168.1.1" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks 169.254.x range", async () => {
    const r = await webFetchTool.execute({ url: "http://169.254.169.254/latest/meta-data/" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks 0.0.0.0", async () => {
    const r = await webFetchTool.execute({ url: "http://0.0.0.0:8000" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Blocked host");
  });

  it("blocks data: URLs", async () => {
    const r = await webFetchTool.execute({ url: "data:text/html,<script>alert(1)</script>" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid URLs", async () => {
    const r = await webFetchTool.execute({ url: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("rejects excessively long URLs", async () => {
    const longUrl = "https://example.com/" + "x".repeat(5000);
    const r = await webFetchTool.execute({ url: longUrl });
    expect(r.success).toBe(false);
    expect(r.error).toContain("maximum length");
  });
});

describe("htmlToBasicMarkdown", () => {
  it("extracts readable content from common HTML", () => {
    const html = `
      <html>
        <body>
          <nav>Skip this</nav>
          <main>
            <h1>Title &amp; More</h1>
            <p>Hello <strong>world</strong>.</p>
            <ul><li>One</li><li><a href="https://example.com">Two</a></li></ul>
          </main>
          <script>bad()</script>
        </body>
      </html>
    `;

    const markdown = htmlToBasicMarkdown(html);
    expect(markdown).toContain("# Title &amp; More");
    expect(markdown).toContain("Hello **world**.");
    expect(markdown).toContain("- One");
    expect(markdown).toContain("[Two](https://example.com)");
    expect(markdown).not.toContain("Skip this");
    expect(markdown).not.toContain("bad()");
  });
});

describe("web fetch extraction diagnostics", () => {
  it("extracts HTML titles", () => {
    expect(extractHtmlTitle("<html><head><title>Ntox &amp; Friends</title></head></html>")).toBe("Ntox & Friends");
  });

  it("flags likely bot walls", () => {
    const diagnostics = diagnoseFetchedContent("Checking your browser. Verify you are human.", true);
    expect(diagnostics).toContain("possible-bot-wall");
    expect(diagnostics).toContain("low-content");
  });

  it("flags HTML without semantic content", () => {
    const diagnostics = diagnoseFetchedContent("<html><body><div></div></body></html>", true);
    expect(diagnostics).toContain("no-semantic-content");
  });
});

describe("htmlToReadableMarkdown", () => {
  it("uses readability for article-like pages", () => {
    const html = `
      <html>
        <head><title>Readable Page</title></head>
        <body>
          <header>Navigation</header>
          <article>
            <h1>Readable Page</h1>
            <p>${"This is useful article content. ".repeat(20)}</p>
          </article>
          <footer>Footer</footer>
        </body>
      </html>
    `;

    const extracted = htmlToReadableMarkdown(html, "https://example.com/readable");
    expect(extracted.extractor).toBe("readability");
    expect(extracted.title).toContain("Readable Page");
    expect(extracted.content).toContain("useful article content");
    expect(extracted.content).not.toContain("Navigation");
  });
});
