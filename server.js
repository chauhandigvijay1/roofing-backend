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
function getGracefulFallback(userMessage = "") {
  const lower = (userMessage || "").toLowerCase();
  if (lower.includes("book") || lower.includes("schedule") || lower.includes("appointment") || lower.includes("inspect")) {
    return (
      "I would be delighted to schedule a free roof inspection for you! Our certified specialists have priority openings tomorrow at 9:00 AM, 11:30 AM, and 2:00 PM.\n\n" +
      "To hold your slot in our calendar, please reply with:\n" +
      "• Your Full Name\n" +
      "• Phone Number\n" +
      "• Property Address\n\n" +
      "Once received, we will reserve your appointment and send a calendar invitation directly to your phone."
    );
  }
  if (lower.includes("pay") || lower.includes("deposit") || lower.includes("invoice") || lower.includes("receipt")) {
    return (
      "We make payments and invoicing seamless!\n\n" +
      "• **Invoice #INV-2026-7840**: Roof Project Advance Deposit ($250.00)\n" +
      "• **Payment Method**: Secure Card/ACH or 0% APR Financing\n" +
      "• **Receipt & Invoice Dispatch**: Sent automatically to your email upon confirmation.\n\n" +
      "Please share your preferred email address so we can route your official itemized PDF invoice and secure payment confirmation!"
    );
  }
  return (
    "Welcome to Premium Roofing! We provide 24/7 emergency roof repairs, lifetime-warranted replacements, free inspections, and flexible 0% APR financing.\n\n" +
    "How can I assist you today? You can ask to book a free roof inspection, request an invoice or estimate, or learn about our roofing options."
  );
}

async function generateChatCompletion(messages, latestUserMessage = "") {
  const groqClient = getGroq();
  if (!groqClient) {
    return {
      reply: getGracefulFallback(latestUserMessage),
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
    reply: getGracefulFallback(latestUserMessage),
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
    const { message, history } = req.body || {};

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

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...sanitizedHistory,
      { role: "user", content: message.trim() },
    ];

    const result = await generateChatCompletion(messages, message);
    return res.status(200).json({
      reply: result.reply,
      model: result.modelUsed,
    });
  } catch (err) {
    console.error("Chat endpoint error:", err);
    // Always return 200 with assistant reply so client frontend never errors
    const fallbackReply = getGracefulFallback(req.body?.message);
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
  generateChatCompletion,
  getGracefulFallback,
};
