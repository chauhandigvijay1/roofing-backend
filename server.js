require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(cors());
app.use(express.json());

const PRIMARY_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// Ordered list of candidate models: primary requested model first, followed by active free-tier fallbacks
const CANDIDATE_MODELS = Array.from(
  new Set([
    PRIMARY_MODEL,
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
  ])
);

// In-Memory 24-Hour Cache for Domain Enrichment
const ENRICH_CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Rate Limiter: Maximum 15 requests per minute per IP to protect API credits and prevent DDoS
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    reply: "Rate limit reached. Please wait a moment before sending more messages, or use our instant booking calendar to schedule an inspection.",
    model: "rate-limit",
  },
  skip: (req) => process.env.NODE_ENV === "test" || req.body?.message === "ping",
});

const SYSTEM_PROMPT = `You are the Elite AI Roofing Concierge for Premium Roofing — an award-winning, licensed, and insured roofing contractor known for top-tier craftsmanship, 25-year manufacturer warranties, and 24/7 emergency response.

You represent a cutting-edge, autonomous AI assistant built to handle end-to-end customer interactions: calendar appointment scheduling, advance deposit payments, instant invoice generation, email dispatch confirmations, and technical roofing consultations.

CORE CAPABILITIES & INSTRUCTIONS:

1. INTELLIGENT CALENDAR BOOKING & SCHEDULING:
- When a customer wants to schedule an inspection, estimate, or repair:
  * Proactively offer convenient booking slots (e.g., Morning slots: 9:00 AM or 11:30 AM; Afternoon slots: 2:00 PM or 4:30 PM for today or the next business day).
  * Prompt for essential details: Full Name, Phone Number, Property Address, and Specific Roof Concern (storm/hail damage, active leak, inspection, full replacement).
  * Confirm the booking reservation:
    - State clearly that the appointment is locked and held in the master dispatch calendar.
    - Confirm an automated calendar invite (.ics) and SMS confirmation are dispatched to their phone.

2. ADVANCE PAYMENTS, DEPOSITS, INVOICE GENERATION & EMAIL RECEIPTS:
- When a customer asks to make an advance payment, deposit, or requests an invoice:
  * Detail payment options: Major credit cards, ACH, and 0% APR financing options.
  * Provide an instant professional prototype invoice summary (#INV-2026-XXXX, $150 - $500 inspection/materials deposit, status "Staged & Ready").
  * Confirm automated dispatch of tax-compliant itemized PDF invoice and official digital receipt.

3. EXPERT ROOFING GUIDANCE:
- Answer questions on architectural shingles, metal standing-seam roofs, flat/TPO roofing, storm/hail restoration, and ventilation.
- Emphasize that initial roof inspections and estimates are 100% free with zero obligation.

4. TONE, STYLE & PRESENTATION:
- Authoritative, polished, warm, and executive.
- Format responses cleanly using markdown bullet points, bold headers, and concise sections.
- STRICT FORMATTING: Do NOT output raw ASCII pipe tables (|---|). Always use bullet points and bold labels for comparisons.
- PRICING REALISM: Typical residential roof replacements range between $8,500 and $16,000 for architectural shingles ($4.50 - $6.50/sq.ft.), and $16,000 to $25,000 for metal systems. Commercial TPO projects typically run $4.50 - $8.00/sq.ft. Never quote inflated six-figure sums ($100k+) for standard residential roofs.`;

function extractState(cityStr = "") {
  if (!cityStr || typeof cityStr !== "string") return "";
  const match = cityStr.match(/,\s*([A-Za-z]{2})\b/);
  return match ? match[1].toUpperCase() : "";
}

function buildSystemPrompt(brand = {}) {
  if (!brand || typeof brand !== "object") {
    return SYSTEM_PROMPT;
  }

  const brandName = brand.name || "Premium Roofing";
  const city = brand.city || "Texas";
  const state = (brand.state || extractState(city) || "").toUpperCase();
  const phone = brand.phone || "(800) 555-ROOF";
  const email = brand.email || "";
  const tagline = brand.tagline || "Elite Craftsmanship, Transparent Pricing & Lifetime Protection";
  const founderName = brand.founderName || "";
  const founderTitle = brand.founderTitle || "";
  const licenseNumber = brand.licenseNumber || "";

  const isFlorida = state === "FL" || city.toLowerCase().includes("fl") || city.toLowerCase().includes("florida");
  const isTexas = state === "TX" || city.toLowerCase().includes("tx") || city.toLowerCase().includes("texas");
  const isCommercial = Boolean(
    brand.isCommercial ||
    (brand.name && brand.name.toLowerCase().includes("commercial")) ||
    (brand.services && JSON.stringify(brand.services).toLowerCase().includes("tpo"))
  );

  let regionalExpertise = "";
  if (isFlorida) {
    regionalExpertise = "Florida Wind Mitigation Inspections: Helping Florida homeowners save on statutory insurance premiums with FBC-compliant hurricane clips and secondary water barrier inspection reports.";
  } else if (isTexas) {
    regionalExpertise = "Texas HB 2102 Deductible Compliance: Full integrity insurance claim forensic scoping with licensed adjusters. Zero illegal deductible waiving.";
  }

  let commercialExpertise = "";
  if (isCommercial) {
    commercialExpertise = "Commercial Flat Roofing Authority: Certified 60-mil/80-mil TPO heat-welded single-ply membranes, modified bitumen, and liquid-applied silicone restoration coatings backed by 20-30 year NDL warranties.";
  }

  return `You are the Elite Lead Qualification AI Concierge for ${brandName} serving ${city} (${state || "USA"}).
Direct Dispatch Hotline: ${phone}${email ? ` | Email: ${email}` : ""}
${founderName ? `Company Principal: ${founderName}${founderTitle ? ` (${founderTitle})` : ""}` : ""}
${licenseNumber ? `Credentials & Licensing: ${licenseNumber}` : ""}
Tagline: "${tagline}"
${regionalExpertise}
${commercialExpertise}

YOUR PRIMARY PURPOSE:
Help property owners get immediate clarity on their roof, answer their specific questions directly, qualify their project scope, and guide them into scheduling a complimentary 21-point on-site inspection.

STRICT RESPONSE RULES (NON-NEGOTIABLE):
1. BREVITY & CONVERSATION: Maximum 2 to 3 concise, natural sentences per response (under 50 words). Never write essays, multi-paragraph lectures, or bullet lists.
2. DIRECT ANSWER FIRST: If the user asks about price, timeline, or warranty, state the realistic answer for ${city} immediately in sentence 1, then ask 1 qualifying question in sentence 2.
3. ZERO INVOICE GENERATION: Never invent simulated invoice deposit numbers (#INV-...), tax lines, or payment processing mockups. Inspections and quotes with ${brandName} are always 100% free with zero deposit.
4. ACTION TRIGGERS (Append exactly ONE tag at the end when intent matches):
   - [ACTION:BOOK] -> Use when user wants to schedule, inspect, get a written quote, or confirms a time.
   - [ACTION:CALC] -> Use when user asks about ballpark pricing, cost per square foot, or cost comparisons.
   - [ACTION:CALL] -> Use when user reports an active emergency leak, interior ceiling dripping, or immediate storm damage.

LEAD QUALIFICATION PLAYBOOK:
- Active Leaks: Acknowledge urgency immediately. Instruct them to call ${phone} for rapid dispatch or request immediate inspection. [ACTION:CALL]
- Residential Replacement: Architectural shingles in ${city} run $4.80–$6.20/sq ft ($11,000–$16,500 turnkey for a typical 2,500 sq ft home) with lifetime warranty. Ask for their approximate square footage or address. [ACTION:CALC]
- Commercial Projects: Confirm our commercial flat roofing division in 60-mil/80-mil TPO and silicone coatings with 20-year NDL warranties. Ask for approximate building square footage. [ACTION:CALC]
- Booking / Appointments: State open priority slots tomorrow morning (9:00 AM - 11:30 AM) or afternoon (2:00 PM - 4:30 PM). Ask which window fits their schedule. [ACTION:BOOK]`;
}

// Ultra-concise, high-converting qualifying fallback responses
function getGracefulFallback(userMessage = "", brand = null) {
  const lower = (userMessage || "").toLowerCase();
  const brandName = brand?.name || "Premium Roofing";
  const city = brand?.city || "your area";
  const phone = brand?.phone || "(800) 555-ROOF";

  if (lower.includes("book") || lower.includes("schedule") || lower.includes("appointment") || lower.includes("inspect")) {
    return `We'd love to schedule your free 21-point on-site inspection in ${city} with ${brandName}! We have open priority windows tomorrow morning at 9:00 AM and afternoon at 2:00 PM. You can also reach our dispatch desk directly at ${phone}. [ACTION:BOOK]`;
  }

  if (lower.includes("price") || lower.includes("cost") || lower.includes("quote") || lower.includes("estimate") || lower.includes("how much")) {
    return `For residential roofs in ${city}, architectural shingles typically range from $4.80 to $6.20 per square foot installed with lifetime warranty. Would you like to model your exact square footage in our instant calculator or schedule a free on-site survey? [ACTION:CALC]`;
  }

  if (lower.includes("leak") || lower.includes("emergency") || lower.includes("storm") || lower.includes("water") || lower.includes("drip") || lower.includes("hole")) {
    return `If you have an active leak or emergency damage in ${city}, our rapid dispatch team is on call. Please call our direct hotline at ${phone} or tap below to request priority emergency dispatch. [ACTION:CALL]`;
  }

  if (lower.includes("commercial") || lower.includes("tpo") || lower.includes("flat") || lower.includes("warehouse") || lower.includes("building")) {
    return `We specialize in commercial flat roofs, TPO heat-welded membranes, and silicone coatings across ${city} backed by 20-year NDL warranties. Approximately how many square feet is your commercial facility? [ACTION:CALC]`;
  }

  return `Welcome to ${brandName} in ${city}! We provide certified residential replacements, commercial flat roofing, and emergency storm restorations. Are you experiencing an active roof issue, or planning a replacement estimate?`;
}

let groq = null;
function getGroq() {
  if (!groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.warn("GROQ_API_KEY is not defined in environment variables.");
      return null;
    }
    const Groq = require("groq-sdk");
    groq = new Groq({ apiKey });
  }
  return groq;
}

async function generateChatCompletion(messages, latestUserMessage = "", brand = null) {
  const groqClient = getGroq();
  if (!groqClient) {
    return {
      reply: getGracefulFallback(latestUserMessage, brand),
      modelUsed: "offline-fallback",
    };
  }

  let lastError = null;
  for (const model of CANDIDATE_MODELS) {
    try {
      const completion = await groqClient.chat.completions.create({
        model,
        messages,
        max_tokens: 350,
        temperature: 0.6,
      });
      const reply = completion.choices[0]?.message?.content;
      if (reply) {
        return { reply, modelUsed: model };
      }
    } catch (err) {
      console.warn(`[Groq] Model "${model}" failed: ${err.message}. Trying next candidate...`);
      lastError = err;
    }
  }

  console.error("[Groq] All candidate models failed, returning graceful fallback response:", lastError?.message);
  return {
    reply: getGracefulFallback(latestUserMessage, brand),
    modelUsed: "graceful-fallback",
  };
}

// Autonomous Domain Enrichment Engine with 3.5s timeout & in-memory 24h cache
async function enrichDomain(rawDomain) {
  if (!rawDomain || typeof rawDomain !== "string") {
    throw new Error("A valid domain is required.");
  }

  let cleanDomain = rawDomain.trim().toLowerCase();
  cleanDomain = cleanDomain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/:\d+$/, "");

  const cached = ENRICH_CACHE.get(cleanDomain);
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const fallbackData = {
    domain: cleanDomain,
    logo: `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=128`,
    tagline: `Premier Commercial & Residential Roofing Specialists in ${cleanDomain}`,
    aboutText: `${cleanDomain} provides certified roofing, restoration, and storm damage repair with lifetime craftsmanship.`,
    rating: 4.9,
    reviewsCount: 38,
    services: [
      "Commercial TPO & Flat Systems",
      "Architectural Shingle Replacement",
      "Standing Seam Metal Roofing",
      "Emergency Storm & Leak Repair",
      "Attic Ventilation & Thermal Survey",
    ],
    serviceAreas: [],
    isCommercial: false,
    enriched: false,
  };

  const targetUrl = `https://${cleanDomain}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      ENRICH_CACHE.set(cleanDomain, { data: fallbackData, timestamp: now });
      return fallbackData;
    }

    const html = await res.text();

    // 1. Logo extraction
    let logoUrl = null;
    const ogImageMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogImageMatch && ogImageMatch[1]) {
      try {
        logoUrl = new URL(ogImageMatch[1], targetUrl).href;
      } catch {}
    }

    if (!logoUrl || (!logoUrl.endsWith(".svg") && !logoUrl.toLowerCase().includes("logo"))) {
      const imgLogoMatch = html.match(/<img[^>]+src=["']([^"']*(?:logo|brand)[^"']*)["'][^>]*>/i);
      if (imgLogoMatch && imgLogoMatch[1]) {
        try {
          logoUrl = new URL(imgLogoMatch[1], targetUrl).href;
        } catch {}
      }
    }

    if (!logoUrl) {
      const iconMatch = html.match(/<link[^>]+rel=["'](?:apple-touch-icon|shortcut icon|icon)["'][^>]+href=["']([^"']+)["']/i);
      if (iconMatch && iconMatch[1]) {
        try {
          logoUrl = new URL(iconMatch[1], targetUrl).href;
        } catch {}
      }
    }

    if (!logoUrl) {
      logoUrl = fallbackData.logo;
    }

    // 2. Tagline extraction
    let tagline = null;
    const metaDescMatch =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ||
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    if (metaDescMatch && metaDescMatch[1]) {
      tagline = metaDescMatch[1].trim().replace(/\s+/g, " ");
    } else {
      const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (h1Match && h1Match[1]) {
        tagline = h1Match[1].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ");
      }
    }
    if (!tagline || tagline.length < 5) {
      tagline = fallbackData.tagline;
    }
    if (tagline.length > 180) {
      tagline = tagline.slice(0, 177) + "...";
    }

    // 3. AboutText extraction
    let aboutText = null;
    const pMatches = html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const p of pMatches) {
      const text = p[1].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ");
      if (
        text.length > 50 &&
        (text.toLowerCase().includes("roof") ||
          text.toLowerCase().includes("contractor") ||
          text.toLowerCase().includes("service"))
      ) {
        aboutText = text;
        break;
      }
    }
    if (!aboutText || aboutText.length < 20) {
      aboutText = tagline || fallbackData.aboutText;
    }
    if (aboutText.length > 300) {
      aboutText = aboutText.slice(0, 297) + "...";
    }

    // 4. Rating & Reviews
    let rating = 4.9;
    let reviewsCount = 42;
    const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const jm of jsonLdMatches) {
      try {
        const parsed = JSON.parse(jm[1].trim());
        const target = parsed["@graph"] ? parsed["@graph"].find((item) => item.aggregateRating) : parsed;
        if (target && target.aggregateRating) {
          const val = parseFloat(target.aggregateRating.ratingValue);
          const count = parseInt(target.aggregateRating.reviewCount || target.aggregateRating.ratingCount, 10);
          if (!isNaN(val) && val >= 3.0 && val <= 5.0) rating = Number(val.toFixed(1));
          if (!isNaN(count) && count > 0) reviewsCount = count;
          break;
        }
      } catch {}
    }

    // 5. Services & Commercial detection
    const lowerHtml = html.toLowerCase();
    const hasTPO = lowerHtml.includes("tpo") || lowerHtml.includes("commercial flat") || lowerHtml.includes("membrane");
    const hasMetal = lowerHtml.includes("metal roof") || lowerHtml.includes("standing seam");
    const hasShingle = lowerHtml.includes("shingle") || lowerHtml.includes("architectural");
    const hasStorm = lowerHtml.includes("storm") || lowerHtml.includes("hail") || lowerHtml.includes("leak") || lowerHtml.includes("emergency");
    const hasGutters = lowerHtml.includes("gutter");
    const isCommercial = hasTPO || lowerHtml.includes("commercial roof") || lowerHtml.includes("industrial");

    const detectedServices = [];
    if (isCommercial) detectedServices.push("Commercial TPO & Single-Ply Flat Roofing");
    if (hasShingle || !isCommercial) detectedServices.push("Architectural Shingle Lifetime Systems");
    if (hasMetal) detectedServices.push("Engineered Standing Seam Metal Roofing");
    if (hasStorm) detectedServices.push("24/7 Emergency Storm Damage & Leak Tarping");
    if (hasGutters) detectedServices.push("Seamless Gutter Systems & Drainage");
    if (lowerHtml.includes("wind mitigation") || lowerHtml.includes("florida")) {
      detectedServices.push("Florida Wind Mitigation Inspections");
    }

    const services = detectedServices.length > 0 ? detectedServices : fallbackData.services;

    // 6. Service Areas extraction
    const detectedAreas = [];
    for (const jm of jsonLdMatches) {
      try {
        const parsed = JSON.parse(jm[1].trim());
        const candidates = parsed["@graph"] ? parsed["@graph"] : [parsed];
        for (const c of candidates) {
          if (c.areaServed) {
            if (Array.isArray(c.areaServed)) {
              for (const a of c.areaServed) {
                const name = typeof a === "string" ? a : a?.name;
                if (name && typeof name === "string" && !detectedAreas.includes(name.trim())) {
                  detectedAreas.push(name.trim());
                }
              }
            } else if (typeof c.areaServed === "string") {
              const parts = c.areaServed.split(",").map((s) => s.trim()).filter(Boolean);
              for (const p of parts) {
                if (!detectedAreas.includes(p)) detectedAreas.push(p);
              }
            }
          }
        }
      } catch {}
    }

    if (detectedAreas.length === 0) {
      const areaSectionMatch = html.match(/(?:areas\s+we\s+serve|service\s+areas|serving\s+the\s+greater|cities\s+served)[\s\S]{1,600}?(?:<\/div>|<\/section>|<\/ul>)/i);
      if (areaSectionMatch) {
        const liMatches = areaSectionMatch[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
        for (const li of liMatches) {
          const cleanCity = li[1].replace(/<[^>]+>/g, "").trim();
          if (cleanCity.length > 2 && cleanCity.length < 35 && !detectedAreas.includes(cleanCity)) {
            detectedAreas.push(cleanCity);
          }
        }
      }
    }

    const serviceAreas = detectedAreas.length > 0 ? detectedAreas.slice(0, 10) : [];

    const enrichedResult = {
      domain: cleanDomain,
      logo: logoUrl,
      tagline,
      aboutText,
      rating,
      reviewsCount,
      services,
      serviceAreas,
      isCommercial,
      enriched: true,
    };

    ENRICH_CACHE.set(cleanDomain, { data: enrichedResult, timestamp: now });
    return enrichedResult;
  } catch (err) {
    clearTimeout(timeoutId);
    ENRICH_CACHE.set(cleanDomain, { data: fallbackData, timestamp: now });
    return fallbackData;
  }
}

app.get("/", (_req, res) => {
  res.status(200).send("Backend is awake!");
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    groqConfigured: !!process.env.GROQ_API_KEY,
    primaryModel: PRIMARY_MODEL,
    candidateModels: CANDIDATE_MODELS,
  });
});

app.get("/api/enrich", async (req, res) => {
  try {
    const domain = req.query.domain;
    if (!domain || typeof domain !== "string" || !domain.trim()) {
      return res.status(400).json({ error: "Query parameter 'domain' is required." });
    }
    const data = await enrichDomain(domain);
    return res.status(200).json(data);
  } catch (err) {
    console.error("Enrichment error:", err.message);
    return res.status(500).json({ error: "Failed to enrich domain." });
  }
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const { message, history, brand } = req.body || {};

    // Immediate fast-path for warm-up pings
    if (message === "ping") {
      return res.status(200).json({ reply: "pong", status: "ready" });
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(200).json({
        reply: "Hello! How can I assist you with your roofing needs today?",
        model: "default",
      });
    }

    const sanitizedHistory = Array.isArray(history)
      ? history
          .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
          .map((h) => ({ role: h.role, content: h.content }))
      : [];

    // 10-Exchange Session Ceiling Guardrail:
    // After 10 user messages in a single session, trigger priority booking handoff
    const userMessageCount = sanitizedHistory.filter((m) => m.role === "user").length + 1;
    if (userMessageCount > 10) {
      return res.status(200).json({
        type: "CONVERSION_HANDOFF",
        reply: "You've unlocked priority scheduling with our executive inspection team! Let's lock in your on-site verification.",
        message: "You've unlocked priority scheduling with our executive inspection team! Let's lock in your on-site verification.",
        model: "handoff-guardrail",
      });
    }

    const activeSystemPrompt = buildSystemPrompt(brand);

    const messages = [
      { role: "system", content: activeSystemPrompt },
      ...sanitizedHistory,
      { role: "user", content: message.trim() },
    ];

    const result = await generateChatCompletion(messages, message, brand);
    return res.status(200).json({
      reply: result.reply,
      model: result.modelUsed,
    });
  } catch (err) {
    console.error("Chat endpoint error:", err);
    const fallbackReply = getGracefulFallback(req.body?.message, req.body?.brand);
    return res.status(200).json({
      reply: fallbackReply,
      model: "error-recovery",
    });
  }
});

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT} (Primary model: ${PRIMARY_MODEL})`);
  });
}

module.exports = {
  app,
  getGroq,
  PRIMARY_MODEL,
  CANDIDATE_MODELS,
  SYSTEM_PROMPT,
  buildSystemPrompt,
  generateChatCompletion,
  getGracefulFallback,
  enrichDomain,
  ENRICH_CACHE,
};
