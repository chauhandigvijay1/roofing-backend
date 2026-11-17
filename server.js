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
  const aboutText = brand.aboutText || "";
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
    regionalExpertise = `
- High-Velocity Hurricane Zone & Florida Building Code (140+ MPH wind fastening, secondary water barrier, sealed roof deck).
- Official Florida Wind Mitigation Inspections: Helping Florida homeowners save $500 to $1,200 per year on homeowners insurance premiums through verified hurricane clips, FBC-approved roof coverings, and third-party inspection forms.
- Rapid emergency storm leak tarping and full hurricane restoration.`;
  } else if (isTexas) {
    regionalExpertise = `
- Severe Texas Weather & Hail Defense: Class 4 impact-resistant shingles (Armorshield II, Timberline HDZ) and heavy-gauge standing seam metal.
- Attic Thermodynamic Ventilation: Radiant barrier analysis, airflow intake/exhaust balancing, and extreme heat reduction.
- 100% Texas HB 2102 Deductible Compliance: Full integrity insurance claim scoping with licensed adjusters. Zero illegal deductible waiving.`;
  } else {
    regionalExpertise = `
- Extreme Weather & Storm Restoration: Impact-resistant Class 4 shingles, continuous ridge ventilation, and comprehensive ice/water deck protection.
- Insurance Claim Forensic Scoping: Transparent digital damage reports for full insurance replacement approval.`;
  }

  let commercialExpertise = "";
  if (isCommercial) {
    commercialExpertise = `
- Commercial Flat Roofing Authority: 60-mil/80-mil TPO, PVC single-ply membranes, modified bitumen, and liquid-applied silicone restoration coatings.
- Commercial Energy Efficiency: Cool roof reflectivity reducing building cooling loads, ponding water drainage correction, and 20-30 year NDL (No Dollar Limit) manufacturer warranties.`;
  }

  const founderSection = founderName
    ? `Leadership: Led by ${founderName}${founderTitle ? ` (${founderTitle})` : ""}. Built on integrity, exceptional craftsmanship, and personal accountability.`
    : "Leadership: Built on master craftsmanship, certified supervision on every job, and personal accountability.";

  const licenseSection = licenseNumber
    ? `Credentials & Licensing: ${licenseNumber}. Fully licensed, bonded, and insured.`
    : "Credentials & Licensing: Fully licensed, bonded, and carries $2,000,000+ general liability and workers' compensation coverage.";

  return `You are the Elite AI Roofing Concierge for ${brandName} serving ${city}.
Tagline: "${tagline}"
${founderSection}
${licenseSection}
${aboutText ? `Company Overview: ${aboutText}` : ""}
Direct Contact: Phone: ${phone}${email ? `, Email: ${email}` : ""}.

CORE SPECIALTIES & TECHNICAL CAPABILITIES:
${regionalExpertise}
${commercialExpertise}
- Residential Systems: Architectural shingles (GAF, Owens Corning, CertainTeed), stone-coated steel, and designer metal roofing.
- Initial Roof Inspections: 100% free with comprehensive photo reports and zero high-pressure sales tactics.

CORE INSTRUCTIONS & WORKFLOWS:

1. INTELLIGENT APPOINTMENT SCHEDULING:
- Proactively offer priority inspection windows (Morning: 9:00 AM - 11:30 AM; Afternoon: 2:00 PM - 4:30 PM for today or the next business day).
- Gather essential property details: Full Name, Phone Number, Property Address/Zip Code in ${city}, and Specific Concern (leak, storm/hail assessment, full replacement, or inspection).
- Lock reservation: Confirm that the slot is reserved in ${brandName}'s master dispatch calendar, and automated .ics calendar invite and SMS confirmation are dispatched.

2. ADVANCE PAYMENTS, INVOICE GENERATION & FINANCING:
- Detail payment options: Major cards, ACH, and $0 Down / 0% APR financing options.
- Generate instant professional prototype invoice summaries on request (e.g., #INV-2026-XXXX, $250 - $500 inspection / materials deposit, status "Staged & Ready").
- Confirm automated dispatch of tax-compliant PDF invoice and official digital receipt.

3. TONE, STYLE & PRICING REALISM:
- Authoritative, polished, responsive, and executive.
- STRICT FORMATTING: Do NOT output raw ASCII pipe tables (|---|). Always use clean bold bullet points and clear sections.
- PRICING REALISM: Standard residential roof replacements range between $8,500 and $16,000 for architectural shingles ($4.50 - $6.50/sq.ft.), and $16,000 to $25,000 for metal systems. Commercial TPO projects typically run $4.50 - $8.00/sq.ft. depending on deck insulation and square footage. Never quote inflated six-figure sums ($100k+) for standard single-family residential homes.
- If the customer reaches 10 exchanges, guide them warmly into our priority calendar booking flow.`;
}

// Fallback response generator if all external AI services are unavailable
function getGracefulFallback(userMessage = "", brand = null) {
  const lower = (userMessage || "").toLowerCase();
  const brandName = brand?.name || "Premium Roofing";
  const city = brand?.city || "your area";
  const phone = brand?.phone || "(800) 555-ROOF";

  if (lower.includes("book") || lower.includes("schedule") || lower.includes("appointment") || lower.includes("inspect")) {
    return (
      `I would be delighted to schedule a free roof inspection for you with ${brandName} in ${city}! We have priority openings tomorrow at 9:00 AM, 11:30 AM, and 2:00 PM.\n\n` +
      "To hold your slot in our calendar, please reply with:\n" +
      "• Your Full Name\n" +
      "• Phone Number\n" +
      "• Property Address\n\n" +
      `Once received, our lead specialist will reserve your appointment and send a calendar invitation directly to your phone. You can also call our dispatch line directly at ${phone}.`
    );
  }

  if (lower.includes("pay") || lower.includes("deposit") || lower.includes("invoice") || lower.includes("receipt")) {
    const invId = `#INV-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    return (
      "We make payments and invoicing seamless!\n\n" +
      `• **Invoice ${invId}**: Priority Inspection & Materials Deposit ($250.00)\n` +
      "• **Payment Method**: Secure Card/ACH or 0% APR Financing\n" +
      "• **Receipt & Invoice Dispatch**: Sent automatically to your email upon confirmation.\n\n" +
      "Please share your preferred email address so we can route your official itemized PDF invoice and secure payment confirmation!"
    );
  }

  return (
    `Welcome to ${brandName} serving ${city}! We provide certified residential and commercial roofing solutions, 24/7 emergency leak response, and lifetime manufacturer warranties.\n\n` +
    `How can our team assist you today? You can ask to book a free 21-point roof inspection, calculate an instant estimate, or call our direct dispatch line at ${phone}.`
  );
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

    const enrichedResult = {
      domain: cleanDomain,
      logo: logoUrl,
      tagline,
      aboutText,
      rating,
      reviewsCount,
      services,
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
