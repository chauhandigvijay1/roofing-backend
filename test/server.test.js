const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const {
  app,
  PRIMARY_MODEL,
  CANDIDATE_MODELS,
  SYSTEM_PROMPT,
  buildSystemPrompt,
  getGracefulFallback,
  enrichDomain,
  ENRICH_CACHE,
} = require("../server");

describe("Roofing Backend Universal API Tests", () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.NODE_ENV = "test";
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

  test("POST /api/chat accepts universal dynamic brand object", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "What roofing materials do you recommend?",
        history: [],
        brand: {
          name: "Worley Byrd Roofing & Restoration",
          city: "Dallas, TX",
          phone: "(214) 555-8822",
          email: "info@worleybyrd.com",
          tagline: "North Texas Roofing Masters",
          founderName: "Marcus Byrd",
          founderTitle: "Managing Principal",
          isCommercial: false,
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.reply === "string");
    assert.ok(data.reply.length > 20);
  });

  test("POST /api/chat enforces 10-exchange session ceiling with CONVERSION_HANDOFF", async () => {
    // Generate 10 prior user exchanges in history
    const history = [];
    for (let i = 1; i <= 10; i++) {
      history.push({ role: "user", content: `Question ${i}` });
      history.push({ role: "assistant", content: `Answer ${i}` });
    }

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Question 11 - Can you tell me more?",
        history,
        brand: {
          name: "Apex Roofing",
          city: "Atlanta, GA",
          phone: "(404) 555-0199",
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.type, "CONVERSION_HANDOFF");
    assert.ok(data.reply.includes("priority scheduling"));
  });

  test("GET /api/enrich requires domain parameter", async () => {
    const res = await fetch(`${baseUrl}/api/enrich`);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  test("GET /api/enrich returns enriched data with caching", async () => {
    const res = await fetch(`${baseUrl}/api/enrich?domain=worleybyrdroofing.com`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.domain, "worleybyrdroofing.com");
    assert.ok(typeof data.logo === "string");
    assert.ok(typeof data.tagline === "string");
    assert.ok(Array.isArray(data.services));
    assert.ok(typeof data.rating === "number");
    assert.ok(typeof data.reviewsCount === "number");

    // Second call should return from memory cache immediately
    const resCached = await fetch(`${baseUrl}/api/enrich?domain=worleybyrdroofing.com`);
    assert.strictEqual(resCached.status, 200);
    const cachedData = await resCached.json();
    assert.strictEqual(cachedData.domain, "worleybyrdroofing.com");
  });

  test("buildSystemPrompt dynamically generates custom prompt without legacy client hardcoding", () => {
    // Test 1: Texas roofer
    const texasPrompt = buildSystemPrompt({
      name: "Summit Commercial Roofing",
      city: "Dallas, TX",
      phone: "(214) 888-0000",
      isCommercial: true,
      founderName: "David Vance",
      founderTitle: "Chief Operations Officer",
    });
    assert.ok(texasPrompt.includes("Summit Commercial Roofing"));
    assert.ok(texasPrompt.includes("Dallas, TX"));
    assert.ok(texasPrompt.includes("Texas HB 2102"));
    assert.ok(texasPrompt.includes("David Vance"));
    assert.ok(texasPrompt.includes("Commercial Flat Roofing Authority"));
    assert.strictEqual(texasPrompt.includes("Drew Boy"), false);
    assert.strictEqual(texasPrompt.includes("Jim Jessup"), false);
    assert.strictEqual(texasPrompt.includes("Richard W. Keathley"), false);

    // Test 2: Florida roofer
    const flPrompt = buildSystemPrompt({
      name: "Coastal Storm Roofing",
      city: "Tampa, FL",
      phone: "(813) 444-2211",
      licenseNumber: "CCC1331890",
    });
    assert.ok(flPrompt.includes("Coastal Storm Roofing"));
    assert.ok(flPrompt.includes("Tampa, FL"));
    assert.ok(flPrompt.includes("Florida Wind Mitigation"));
    assert.ok(flPrompt.includes("CCC1331890"));
    assert.strictEqual(flPrompt.includes("Drew Boy"), false);
    assert.strictEqual(flPrompt.includes("Jim Jessup"), false);

    // Test 3: Null brand fallback
    const generic = buildSystemPrompt(null);
    assert.strictEqual(generic, SYSTEM_PROMPT);
  });

  test("getGracefulFallback provides universal responses for any contractor", () => {
    const brand = {
      name: "Pinnacle Roofing Systems",
      city: "Denver, CO",
      phone: "(303) 777-9911",
    };

    const bookReply = getGracefulFallback("I want to book an inspection", brand);
    assert.ok(bookReply.includes("Pinnacle Roofing Systems"));
    assert.ok(bookReply.includes("Denver, CO"));
    assert.ok(bookReply.includes("(303) 777-9911"));

    const generalReply = getGracefulFallback("Hello", brand);
    assert.ok(generalReply.includes("Pinnacle Roofing Systems"));
    assert.ok(generalReply.includes("Denver, CO"));
    assert.strictEqual(generalReply.includes("Jim Jessup"), false);
    assert.strictEqual(generalReply.includes("Drew Boy"), false);
    assert.strictEqual(generalReply.includes("Richard"), false);
  });
});
