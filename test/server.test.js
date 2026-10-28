const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { app, PRIMARY_MODEL, CANDIDATE_MODELS, SYSTEM_PROMPT, buildSystemPrompt, getGracefulFallback } = require("../server");

describe("Roofing Backend API Tests", () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("GET / returns 200 and awake message", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.strictEqual(text, "Backend is awake!");
  });

  test("GET /health reports status, Groq config, and primary model", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, "ok");
    assert.strictEqual(data.primaryModel, "llama-3.3-70b-versatile");
    assert.ok(Array.isArray(data.candidateModels));
    assert.ok(data.candidateModels.includes("llama-3.3-70b-versatile"));
  });

  test("POST /api/chat handles ping quickly", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "ping" }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.reply, "pong");
    assert.strictEqual(data.status, "ready");
  });

  test("POST /api/chat handles empty or missing message gracefully", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.reply === "string");
    assert.ok(data.reply.length > 0);
  });

  test("POST /api/chat returns successful 200 response with assistant reply", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Hi, I need an inspection for my shingle roof",
        history: [],
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.reply === "string");
    assert.ok(data.reply.length > 20);
    assert.ok(data.model);
  });

  test("POST /api/chat accepts brand object and responds for Drew Boy", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Tell me about your building science inspection in Austin",
        history: [],
        brand: {
          name: "Instant Roofing & Exteriors",
          city: "Austin, TX",
          phone: "(512) 888-9999",
          email: "support@instantrfg.com",
          isDrew: true,
          isRichard: false,
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.reply === "string");
    assert.ok(data.reply.length > 20);
  });

  test("POST /api/chat accepts brand object and responds for Richard & David", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Tell me about your commercial flat roof inspection in Houston",
        history: [],
        brand: {
          name: "Paramount Roofing Inc.",
          city: "Houston, TX",
          phone: "(713) 748-4000",
          email: "service@paramountroofing.com",
          isDrew: false,
          isRichard: true,
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.reply === "string");
    assert.ok(data.reply.length > 20);
  });

  test("POST /api/chat handles booking and calendar inquiries", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Can I book a roof inspection slot for tomorrow afternoon?",
        history: [],
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.reply === "string");
    assert.ok(data.reply.length > 50);
  });

  test("POST /api/chat handles payment and invoice inquiries", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "I want to make an advance deposit payment. Can you generate an invoice?",
        history: [],
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.reply === "string");
    assert.ok(data.reply.length > 50);
  });

  test("buildSystemPrompt generates tailored system prompt based on brand", () => {
    const drewPrompt = buildSystemPrompt({
      name: "Instant Roofing & Exteriors",
      city: "Austin, TX",
      isDrew: true,
    });
    assert.ok(drewPrompt.includes("Drew Boy"));
    assert.ok(drewPrompt.includes("Building Science"));
    assert.ok(drewPrompt.includes("Texas HB 2102"));
    assert.ok(drewPrompt.includes("GAF Certified Plus"));
    assert.ok(drewPrompt.includes("Housecall Pro"));

    // Other roofers in Austin should NOT get Drew Boy prompt
    const otherAustinPrompt = buildSystemPrompt({
      name: "Apex Roofing",
      city: "Austin, TX",
      isDrew: false,
    });
    assert.strictEqual(otherAustinPrompt.includes("Drew Boy"), false);

    // Richard & David in Houston
    const paramountPrompt = buildSystemPrompt({
      name: "Paramount Roofing Inc.",
      city: "Houston, TX",
      isRichard: true,
    });
    assert.ok(paramountPrompt.includes("Paramount Roofing"));
    assert.ok(paramountPrompt.includes("Richard W. Keathley and David"));
    assert.ok(paramountPrompt.includes("Houston"));
    assert.ok(paramountPrompt.includes("31+ years"));
    assert.ok(paramountPrompt.includes("BBB A+"));
    assert.ok(paramountPrompt.includes("Houston Apartment Association"));

    // Paramount outside Houston should NOT trigger Richard prompt (dual condition check)
    const paramountDallasPrompt = buildSystemPrompt({
      name: "Paramount Roofing Inc.",
      city: "Dallas, TX",
      isRichard: false,
    });
    assert.strictEqual(paramountDallasPrompt.includes("Richard W. Keathley"), false);

    // Apex in Houston should NOT trigger Richard prompt
    const apexHoustonPrompt = buildSystemPrompt({
      name: "Apex Roofing",
      city: "Houston, TX",
      isRichard: false,
    });
    assert.strictEqual(apexHoustonPrompt.includes("Richard W. Keathley"), false);

    const genericPrompt = buildSystemPrompt(null);
    assert.strictEqual(genericPrompt, SYSTEM_PROMPT);
  });

  test("getGracefulFallback provides appropriate offline responses", () => {
    const bookReply = getGracefulFallback("I want to book an appointment");
    assert.ok(bookReply.includes("inspection") || bookReply.includes("schedule"));

    const payReply = getGracefulFallback("How do I pay deposit and get invoice?");
    assert.ok(payReply.includes("Invoice") || payReply.includes("Deposit"));

    const generalReply = getGracefulFallback("Hello");
    assert.ok(generalReply.includes("Premium Roofing"));

    const drewFallback = getGracefulFallback("Hello", { isDrew: true, name: "Instant Roofing & Exteriors", city: "Austin, TX" });
    assert.ok(drewFallback.includes("Instant Roofing") || drewFallback.includes("Drew Boy"));

    const richardFallback = getGracefulFallback("Hello", { isRichard: true, name: "Paramount Roofing Inc.", city: "Houston, TX" });
    assert.ok(richardFallback.includes("Paramount Roofing") || richardFallback.includes("Richard"));

    const otherAustinFallback = getGracefulFallback("Hello", { isDrew: false, name: "Apex Roofing", city: "Austin, TX" });
    assert.strictEqual(otherAustinFallback.includes("Drew Boy"), false);
  });
});
