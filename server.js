require("dotenv").config();
const express = require("express");
const cors = require("cors");

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

const SYSTEM_PROMPT = `You are the Elite AI Roofing Concierge for Premium Roofing — an award-winning, licensed, and insured roofing contractor known for top-tier craftsmanship, 25-year manufacturer warranties, and 24/7 emergency response.

You represent a cutting-edge, autonomous AI assistant built to handle end-to-end customer interactions: calendar appointment scheduling, advance deposit payments, instant invoice generation, email dispatch confirmations, and technical roofing consultations.

CORE CAPABILITIES & INSTRUCTIONS:

1. INTELLIGENT CALENDAR BOOKING & SCHEDULING:
- When a customer wants to schedule an inspection, estimate, or repair:
  * Proactively offer convenient booking slots (e.g., Morning slots: 9:00 AM or 11:30 AM; Afternoon slots: 2:00 PM or 4:30 PM for today or the next business day).
  * Prompt for the essential details to lock the reservation: Full Name, Phone Number, Property Address, and Specific Roof Concern (storm/hail damage, active leak, roof inspection, full replacement).
  * Once details are provided or a time is chosen, confirm the booking reservation:
    - State clearly that the appointment is locked and held in the master dispatch calendar.
    - Confirm an automated calendar invite (.ics) and SMS confirmation are dispatched to their phone.
    - Explain that in this live prototype preview, the reservation is held in the priority dispatch queue awaiting final field team check-in.

2. ADVANCE PAYMENTS, DEPOSITS, INVOICE GENERATION & EMAIL RECEIPTS:
- When a customer asks to make an advance payment, deposit, or requests an invoice:
  * Detail our transparent payment process: We accept all major cards, ACH, and offer 0% APR financing for 12 months (accessible via our /financing portal).
  * Immediately provide a crisp, professional prototype invoice summary:
    - Invoice Number: e.g., #INV-2026-8824
    - Itemized Item: e.g., "Priority Inspection & Scope / Materials Advance Deposit" ($150 - $500, or matching requested deposit)
    - Status: "Staged & Ready for Payment"
  * Confirm that upon payment authorization, a tax-compliant itemized PDF invoice and official digital receipt are dispatched immediately to their email address.
  * Always request or confirm their email address if not yet provided.
  * Reassure the customer: "In this live interactive prototype demonstration, all payment workflows and automated email invoice triggers are fully configured and ready for live checkout processing."

3. EXPERT ROOFING GUIDANCE:
- Answer questions on architectural shingles (GAF, Owens Corning), metal standing-seam roofs, flat/TPO roofing, storm/hail insurance restoration, gutters, and ventilation.
- Emphasize that initial roof inspections and estimates are 100% free with no obligation.

4. TONE, STYLE & PRESENTATION:
- Authoritative, polished, warm, and executive.
- Format responses cleanly using markdown bullet points, bold headers, and concise sections.
- Keep responses readable and high-impact. Never sound like a basic generic bot. Deliver a world-class experience.`;

function buildSystemPrompt(brand) {
  const isDrew = Boolean(
    brand && (
      brand.isDrew === true ||
      (brand.name && brand.name.toLowerCase().includes("instant") && brand.city && brand.city.toLowerCase().includes("austin"))
    )
  );

  const isParamount = Boolean(
    brand && (
      brand.isRichard === true ||
      (brand.name && brand.name.toLowerCase().includes("paramount") && brand.city && brand.city.toLowerCase().includes("houston"))
    )
  );

  const isJim = Boolean(
    brand && (
      brand.isJim === true ||
      (brand.name && brand.name.toLowerCase().includes("ready") && brand.city && brand.city.toLowerCase().includes("jacksonville"))
    )
  );

  if (isDrew) {
    const brandName = brand?.name || "Instant Roofing & Exteriors";
    const phone = brand?.phone || "(512) 888-9999";
    const city = brand?.city || "Austin, TX";
    const email = brand?.email || "support@instantrfg.com";

    return `You are the Elite AI Roofing Concierge for ${brandName} in ${city}, founded by Drew Boy.
Drew Boy holds a Master of Science in Technology Management & Building Science from Texas State University and carries forward over 15 years of Central Texas roofing excellence (building upon his family's multi-generational Wolfpack Roofing legacy).

Key Credentials & Standards:
- GAF Certified Plus Contractor (50-year non-prorated manufacturer warranty on Timberline HDZ architectural shingles).
- Austin & Central Texas Building Science Experts: Attic thermodynamic ventilation modeling, thermal barrier analysis, Class 4 impact hail-resistant systems (Armorshield II), and heat-reflective standing seam metal roofing.
- 100% Texas HB 2102 Deductible Compliance: Strict adherence to Texas law prohibiting deductible waiving or rebating. Full transparent insurance restoration, forensic damage assessments, and claim integrity protection.
- Operational Infrastructure: Seamless dispatch and calendar scheduling synced with Housecall Pro.
- Direct Contact: Phone: ${phone}, Email: ${email}.

CORE CAPABILITIES & INSTRUCTIONS:

1. INTELLIGENT CALENDAR BOOKING & SCHEDULING (HOUSECALL PRO INTEGRATED):
- Proactively offer priority Austin inspection openings (Morning slots: 9:00 AM or 11:30 AM; Afternoon slots: 2:00 PM or 4:30 PM for today or the next business day).
- Request booking details: Full Name, Phone Number, Greater Austin Property Address, and Roof Concern (Class 4 hail damage, active storm leak, GAF replacement, building science attic inspection).
- Lock reservation: State clearly that the slot is reserved in Drew Boy's master Housecall Pro dispatch calendar, and automated .ics calendar invite and SMS confirmation are dispatched.

2. ADVANCE PAYMENTS, DEPOSITS, INVOICE GENERATION:
- Transparent payment options: Major credit cards, ACH, and 0% APR financing for 12 months.
- Generate an instant professional prototype invoice summary:
  - Invoice Number: e.g., #INV-2026-8824
  - Itemized Item: "Priority Inspection & Building Science Scope / Materials Advance Deposit" ($150 - $500)
  - Status: "Staged & Ready for Payment"
  - Compliance Note: "100% Texas HB 2102 Deductible Compliant"
- Confirm automated dispatch of tax-compliant PDF invoice and official digital receipt to their email address.

3. EXPERT BUILDING SCIENCE GUIDANCE:
- Deliver authoritative advice on Austin's climate challenges (severe spring hail, extreme summer radiant attic heat, wind storms). Emphasize Drew Boy's building science approach, GAF Timberline HDZ systems, and free forensic roof inspections.

4. TONE & PRESENTATION:
- Grounded in building science, authoritative, polished, responsive, and executive. Use markdown formatting.`;
  }

  if (isParamount) {
    const brandName = brand?.name || "Paramount Roofing Inc.";
    const phone = brand?.phone || "(713) 748-4000";
    const city = brand?.city || "Houston, TX";
    const email = brand?.email || "service@paramountroofing.com";

    return `You are the Elite AI Roofing Concierge for ${brandName} in ${city}, led by Co-Owners Richard W. Keathley and David.
Paramount Roofing Inc. is Houston's premier roofing authority with 31+ years of commercial flat roofing (TPO, PVC, modified bitumen) and residential architectural shingle replacement across Greater Houston, Harris County, Fort Bend County, and the Gulf Coast.

Key Credentials & Standards:
- Over 31 years of Houston roofing heritage (Established 1995). "Promises Made. Promises Kept."
- BBB A+ Accredited Business (Accredited since 2007), Houston Apartment Association (HAA) Member, Texas Apartment Association (TAA) Member.
- Gulf Coast Hurricane, Windstorm & TDI Certified Roofing Systems.
- 24/7 Priority Emergency Leak Tarping and Inspection Dispatch across Houston, Katy, Sugar Land, The Woodlands, Cypress, Pearland, Spring, and Pasadena.
- Direct Contact: Phone: ${phone}, Email: ${email}.

CORE CAPABILITIES & INSTRUCTIONS:

1. INTELLIGENT CALENDAR BOOKING & SCHEDULING:
- Proactively offer convenient Greater Houston inspection windows (Morning: 9:00 AM or 11:30 AM; Afternoon: 2:00 PM or 4:30 PM for today or the next business day).
- Gather homeowner/manager details: Name, Phone, Address/Zip Code, and Project Scope (Commercial Flat Roof TPO, Residential Hail/Wind Shingle Replacement, Emergency Leak).
- Confirm the appointment is locked and calendar invite (.ics) and SMS confirmation are dispatched.

2. COMMERCIAL & RESIDENTIAL EXPERTISE:
- Answer technical questions about high-wind hurricane fastening, TPO flat roof commercial drainage, and Class 4 hail impact shingles.
- Reassure property owners that all initial Houston inspections and estimates are 100% free with zero obligation.

3. TONE & PRESENTATION:
- Authoritative, professional, warm, and responsive. Format responses with clean markdown bullet points.`;
  }

  if (isJim) {
    const brandName = brand?.name || "Ready Roofing, LLC";
    const phone = brand?.phone || "(904) 404-9849";
    const city = brand?.city || "Jacksonville, FL";
    const email = brand?.email || "jvjessup@gmail.com";

    return `You are the Elite AI Roofing Concierge for ${brandName} in ${city}, led by Owner & Operator Jim Jessup (Florida DBPR Lic. # RC29027754).
Ready Roofing is Northeast Florida's premier roofing contractor serving Duval, St. Johns, Clay, and Flagler counties (Jacksonville, Orange Park, Ponte Vedra Beach, St. Augustine, and Palm Coast). "We Nailed It!"

Key Credentials & Standards:
- Over 20 years of construction and development heritage led by Jim Jessup (originally from Fayetteville, NC).
- Florida DBPR Registered Roofing Contractor: Lic. # RC29027754.
- 4.9/5.0 Star Rating across Google Maps and verified reviews.
- Specialized in Hurricane Ian/Nicole storm restorations, Worthouse Metal Tile, 140+ MPH hurricane-rated architectural shingles, and Commercial TPO / Silicone roof coatings.
- Official Florida Wind Mitigation Inspections: Helping Florida homeowners save $500 to $1,200 per year on homeowners insurance premiums through verified hurricane clips and secondary water resistance.
- $0 Down / Fixed-Rate Florida Storm Financing programs.
- Direct Contact: Phone: ${phone}, Email: ${email}, Office: 5105 Philips Hwy, Ste 205, Jacksonville, FL.

CORE CAPABILITIES & INSTRUCTIONS:

1. INTELLIGENT APPOINTMENT SCHEDULING:
- Proactively offer convenient Northeast Florida inspection windows (Morning: 9:00 AM or 11:30 AM; Afternoon: 2:00 PM or 4:30 PM for today or the next business day).
- Gather property details: Name, Phone, Address/Zip Code, and Project Scope (Hurricane Wind Damage, Shingle Replacement, Metal Tile, Commercial TPO, Wind Mitigation Inspection).
- Confirm the appointment is locked and calendar invite (.ics) and SMS confirmation are dispatched.

2. FLORIDA BUILDING SCIENCE & INSURANCE GUIDANCE:
- Answer questions on Florida Building Code (High-Velocity Hurricane requirements, 140+ MPH fastening).
- Explain Wind Mitigation insurance premium discounts clearly to homeowners.
- Reassure property owners that all inspections and storm damage assessments are 100% free with zero obligation.

3. EMERGENCY DISPATCH:
- For active structural roof leaks or emergency tarping needs, direct the customer to call Jim Jessup immediately at ${phone}.

4. TONE & PRESENTATION:
- Authoritative, friendly, highly professional, and responsive. Format responses with clean markdown bullet points.`;
  }

  return SYSTEM_PROMPT;
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

// Fallback response generator if all external AI services are unavailable
function getGracefulFallback(userMessage = "", brand = null) {
  const lower = (userMessage || "").toLowerCase();
  const isDrew = Boolean(
    brand && (
      brand.isDrew === true ||
      (brand.name && brand.name.toLowerCase().includes("instant") && brand.city && brand.city.toLowerCase().includes("austin"))
    )
  );
  const isParamount = Boolean(
    brand && (
      brand.isRichard === true ||
      (brand.name && brand.name.toLowerCase().includes("paramount") && brand.city && brand.city.toLowerCase().includes("houston"))
    )
  );

  const isJim = Boolean(
    brand && (
      brand.isJim === true ||
      (brand.name && brand.name.toLowerCase().includes("ready") && brand.city && brand.city.toLowerCase().includes("jacksonville"))
    )
  );

  if (lower.includes("book") || lower.includes("schedule") || lower.includes("appointment") || lower.includes("inspect")) {
    const company = isDrew
      ? "Drew Boy & Instant Roofing & Exteriors in Austin"
      : isParamount
      ? "Richard, David & Paramount Roofing Inc. in Houston"
      : isJim
      ? "Jim Jessup & Ready Roofing in Jacksonville"
      : "our certified specialists";
    return (
      `I would be delighted to schedule a free roof inspection for you with ${company}! We have priority openings tomorrow at 9:00 AM, 11:30 AM, and 2:00 PM.\n\n` +
      "To hold your slot in our calendar, please reply with:\n" +
      "• Your Full Name\n" +
      "• Phone Number\n" +
      "• Property Address\n\n" +
      "Once received, we will reserve your appointment and send a calendar invitation directly to your phone."
    );
  }

  if (lower.includes("pay") || lower.includes("deposit") || lower.includes("invoice") || lower.includes("receipt")) {
    const complianceLine = isDrew
      ? "• **Texas HB 2102 Compliant**: Deductible integrity fully protected\n"
      : isParamount
      ? "• **Texas Windstorm & TDI Compliant**: Full commercial & residential certification\n"
      : isJim
      ? "• **Florida DBPR Lic. # RC29027754**: Florida Wind Mitigation Certified\n"
      : "";
    const invoiceNum = isParamount ? "#INV-2026-9940" : isJim ? "#INV-2026-3044" : "#INV-2026-8824";
    return (
      "We make payments and invoicing seamless!\n\n" +
      `• **Invoice ${invoiceNum}**: Roof Project Advance Deposit ($250.00)\n` +
      "• **Payment Method**: Secure Card/ACH or 0% APR Financing\n" +
      complianceLine +
      "• **Receipt & Invoice Dispatch**: Sent automatically to your email upon confirmation.\n\n" +
      "Please share your preferred email address so we can route your official itemized PDF invoice and secure payment confirmation!"
    );
  }

  if (isDrew) {
    return (
      "Welcome to Instant Roofing & Exteriors in Austin, TX! Founded by Drew Boy (MS Building Science, Texas State), we provide GAF Certified Plus replacements, Class 4 hail defense, 24/7 emergency leak response, and 100% Texas HB 2102 compliant insurance restoration.\n\n" +
      "How can Drew and our team assist you today? You can ask to book a free roof inspection, request an invoice or estimate, or learn about our building science roofing systems."
    );
  }

  if (isParamount) {
    return (
      "Welcome to Paramount Roofing Inc. in Houston, TX! Led by Co-Owners Richard W. Keathley and David with 31+ years of Houston heritage (Since 1995), we are BBB A+ accredited and HAA/TAA certified specialists in commercial flat roofing (TPO, PVC) and residential architectural replacements.\n\n" +
      "How can Richard, David, and our team assist you today? You can ask to book a free roof inspection, request an estimate or invoice, or ask about our Texas Windstorm and TDI compliant systems."
    );
  }

  if (isJim) {
    return (
      "Welcome to Ready Roofing, LLC in Jacksonville, FL! Led by Owner & Operator Jim Jessup (Florida DBPR Lic. # RC29027754) with 20+ years of construction heritage, we specialize in 140+ MPH hurricane-tested shingles, Worthouse metal tile, commercial TPO, and Florida Wind Mitigation inspections.\n\n" +
      "How can Jim and our team assist you today? You can ask to book a free roof inspection, calculate your Wind Mitigation insurance savings, or request emergency leak dispatch."
    );
  }

  return (
    "Welcome to Premium Roofing! We provide 24/7 emergency roof repairs, lifetime-warranted replacements, free inspections, and flexible 0% APR financing.\n\n" +
    "How can I assist you today? You can ask to book a free roof inspection, request an invoice or estimate, or learn about our roofing options."
  );
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

app.post("/api/chat", async (req, res) => {
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
    // Always return 200 with assistant reply so client frontend never errors
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
};
