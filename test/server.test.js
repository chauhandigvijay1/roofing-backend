const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { app, PRIMARY_MODEL, CANDIDATE_MODELS, getGracefulFallback } = require("../server");

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

  test("getGracefulFallback provides appropriate offline responses", () => {
    const bookReply = getGracefulFallback("I want to book an appointment");
    assert.ok(bookReply.includes("inspection") || bookReply.includes("schedule"));

    const payReply = getGracefulFallback("How do I pay deposit and get invoice?");
    assert.ok(payReply.includes("Invoice") || payReply.includes("Deposit"));

    const generalReply = getGracefulFallback("Hello");
    assert.ok(generalReply.includes("Premium Roofing"));
  });
});
