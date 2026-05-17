import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Initialize OpenAI (Lazy/Fallback)
let openai: OpenAI | null = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

const SYSTEM_PROMPT = `
You are 'SpendSense AI', a smart financial assistant inside a smart expense tracker app.
Your job is to:
1. Detect Intent: 'entry' (adding), 'search' (querying), or 'advice' (analysis/tips).
2. Extract Structured Data:
   - For 'entry': type (income/expense), amount, description, category, date (YYYY-MM-DD).
   - For 'search': category, start_date, end_date (YYYY-MM-DD), aggregation (sum/list), language (en/hi/as).
3. Provide Financial Insights: Use the provided 'User's Financial Context' (if present) to answer questions about balances or history. For 'advice', analyze spending and give smart saving tips.
4. Multilingual support: Handle English, Hindi, and Assamese.

Style:
- Always respond in a short, clear format. 
- If adding an expense, include a small personalized tip if the context shows high spending in that category.
- Use Gemini for fast queries and OpenAI (ChatGPT) for complex analysis.

Context:
- Current Date: {{CURRENT_DATE}}
- Available Categories: Food, Transport, Utilities, Health, Dining, Shopping, Education, Finance, Family, Salary, Business, Freelance, Investment, Gift, Other.

Return ONLY JSON matching the schema.
`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["entry", "search", "advice"] },
    suggestions: { type: "array", items: { type: "string" } },
    reply: { type: "string" },
    entry: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["income", "expense"] },
        amount: { type: "number" },
        description: { type: "string" },
        category: { type: "string" },
        tip: { type: "string" }
      }
    },
    search: {
      type: "object",
      properties: {
        category: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        aggregation: { type: "string", enum: ["sum", "list", "average"] },
        language: { type: "string", enum: ["en", "hi", "as"] }
      }
    }
  },
  required: ["intent", "suggestions"]
};

function parseLocally(text: string, context?: any) {
  const t = text.toLowerCase();
  
  // 1. Check for Summary/Search intent first
  const searchKeywords = ["summary", "report", "history", "total", "balance", "search", "find", "how much", "spent", "earned"];
  if (searchKeywords.some(kw => t.includes(kw))) {
    let reply = "Here is your summary:";
    
    // Attempt detailed item search if context is provided
    let itemQuery = "";
    if (t.includes("on ")) itemQuery = t.split("on ")[1]?.trim();
    else if (t.includes("for ")) itemQuery = t.split("for ")[1]?.trim();
    else if (t.includes("find ")) itemQuery = t.split("find ")[1]?.trim();
    else if (t.includes("search ")) itemQuery = t.split("search ")[1]?.replace("search", "").trim();

    if (itemQuery && context?.recent) {
       const filtered = context.recent.filter((t: any) => 
         t.description.toLowerCase().includes(itemQuery.toLowerCase()) || 
         t.category.toLowerCase().includes(itemQuery.toLowerCase())
       );
       const total = filtered.reduce((s: number, t: any) => s + t.amount, 0);
       const type = t.includes("earned") || t.includes("income") ? "income" : "expense";
       const relevantFiltered = filtered.filter((f: any) => f.type === type);
       const relevantTotal = relevantFiltered.reduce((s: number, t: any) => s + t.amount, 0);

       if (filtered.length > 0) {
         return {
           intent: "advice",
           suggestions: ["Detailed Reports", "All History", "Record Again"],
           reply: `I found ${filtered.length} transactions related to "${itemQuery}". Total ${type === 'income' ? 'earned' : 'spent'} is ₹${relevantTotal.toFixed(2)}. (AI Backup Mode)`
         };
       }
    }

    if (context?.summary) {
      reply = `Your current balance is ₹${context.summary.balance.toFixed(2)}. Total Expenses: ₹${context.summary.totalExpense}. Total Income: ₹${context.summary.totalIncome}.`;
    }
    return {
      intent: "advice",
      suggestions: ["Show recent transactions", "Food report", "Add 500 Food"],
      reply: `${reply} (AI is resting, using local summary)`
    };
  }

  // 2. Check for entry intent
  const amountRegex = /(\d+(\.\d+)?)/;
  const match = text.match(amountRegex);
  if (match) {
    const amount = parseFloat(match[1]);
    const cleanText = text.replace(match[1], '').trim();
    const remaining = cleanText.toLowerCase();
    
    // Improved category detection
    const categoryMap: { [key: string]: string[] } = {
      "Food": ["food", "lunch", "dinner", "breakfast", "swiggy", "zomato", "grocery", "groceries", "eat", "restaurant", "dining", "tea", "coffee", "milk", "vegetables", "fruit"],
      "Transport": ["transport", "petrol", "fuel", "diesel", "auto", "cab", "uber", "ola", "bus", "train", "metro", "parking"],
      "Utilities": ["utilities", "bill", "electricity", "water", "gas", "recharge", "mobile", "internet", "wifi", "rent"],
      "Health": ["health", "medicine", "doctor", "hospital", "clinic", "pharmacy", "medical"],
      "Shopping": ["shopping", "amazon", "flipkart", "clothes", "shoes", "gift"],
      "Education": ["education", "school", "college", "fees", "book", "course"],
      "Finance": ["finance", "loan", "emi", "interest", "tax", "insurance"],
      "Family": ["family", "house", "home", "kids", "wife", "mom", "dad"],
      "Salary": ["salary", "pay", "income", "stipend"],
      "Freelance": ["freelance", "project", "gig", "client"],
      "Investment": ["investment", "stock", "mutual fund", "crypto", "gold"],
      "Gift": ["gift", "present", "birthday"]
    };

    let foundCategory = "Other";
    for (const [cat, words] of Object.entries(categoryMap)) {
      if (words.some(word => remaining.includes(word))) {
        foundCategory = cat;
        break;
      }
    }
    
    const isIncome = remaining.includes("received") || 
                    remaining.includes("income") || 
                    remaining.includes("earned") || 
                    remaining.includes("got") || 
                    remaining.includes("salary") || 
                    remaining.includes("freelance") ||
                    remaining.includes("investment");

    return {
      intent: "entry",
      entry: {
        type: isIncome ? "income" : "expense",
        amount: amount,
        description: cleanText || foundCategory,
        category: foundCategory,
        tip: "Recorded in fallback mode."
      },
      suggestions: ["Check summary", "Add another", "Set budget"],
      reply: `Got it! Recorded ₹${amount} for ${cleanText || foundCategory}. (Note: AI systems are busy, so I used a simple backup!)`
    };
  }

  // 3. General Fallback
  return null;
}

// API endpoint to process messages
app.post("/api/chat", async (req, res) => {
  const { text, current_date, model_flavor, transaction_context } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  // Pre-filter: Check if it's a very simple transaction to save AI quota
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && /\d/.test(text)) {
    const preResult = parseLocally(text, transaction_context);
    if (preResult && preResult.intent === "entry") {
      console.log("Using pre-filter local parser for simple entry");
      return res.json(preResult);
    }
  }

  let contextString = "";
  if (transaction_context) {
    contextString = `
User's Financial Context:
- Summary: ${JSON.stringify(transaction_context.summary)}
- Category Totals: ${JSON.stringify(transaction_context.categories)}
- Recent Transactions: ${JSON.stringify(transaction_context.recent)}
`;
  }

  const promptContext = SYSTEM_PROMPT.replace("{{CURRENT_DATE}}", current_date || new Date().toISOString()) + "\n" + contextString;
  
  // Model selection logic based on Master Prompt
  // We prefer OpenAI if available as it often has better stability in this environment
  const isComplex = text.length > 80 || 
                    /\b(advice|budget|why|analysis|insight|suggest|compare|overspending|history|summary|total|report|search|find|show)\b/i.test(text);
  
  // If OpenAI is available, we lean towards it to avoid hitting small Gemini quotas
  let useOpenAI = !!openai && (model_flavor === 'gpt' || isComplex || text.length > 20);

  try {
    let result;

    // Try primary chosen model
    if (useOpenAI && openai) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: promptContext },
            { role: "user", content: text }
          ],
          response_format: { type: "json_object" }
        });
        result = JSON.parse(response.choices[0].message.content || "{}");
      } catch (openaiError: any) {
        if (openaiError?.status === 401) {
          console.warn("OpenAI API key invalid. Falling back to Gemini.");
        } else {
          console.log("OpenAI failed, trying Gemini fallback...");
        }
        useOpenAI = false; 
      }
    }

    // Try Gemini if OpenAI wasn't used or failed
    if (!result) {
      try {
        const response = await genAI.models.generateContent({ 
          model: "gemini-flash-latest",
          contents: [{ role: "user", parts: [{ text }] }],
          config: {
            systemInstruction: promptContext,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA as any
          }
        });
        result = JSON.parse(response.text || "{}");
      } catch (geminiError: any) {
    // If Gemini fails and we haven't tried OpenAI yet, try it now silently
        if (openai && !useOpenAI) {
          try {
            const response = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: promptContext },
                { role: "user", content: text }
              ],
              response_format: { type: "json_object" }
            });
            result = JSON.parse(response.choices[0].message.content || "{}");
          } catch (secondError) {
             throw geminiError; 
          }
        } else {
          throw geminiError;
        }
      }
    }

    res.json(result);
  } catch (error: any) {
    const errorMessage = error?.message?.toLowerCase() || "";
    const errorStatus = error?.status || error?.code || 0;
    
    const isQuotaError = errorStatus === 429 || 
                        errorStatus === "RESOURCE_EXHAUSTED" ||
                        errorMessage.includes("quota") || 
                        errorMessage.includes("rate limit") ||
                        errorMessage.includes("429");

    if (isQuotaError) {
      const fallback = parseLocally(text, transaction_context);
      if (fallback) {
        console.log("AI Quota reached. Using local fallback for:", text.substring(0, 30));
        return res.json(fallback);
      }
      
      // If even local parser fails, return a friendly advice object instead of 429 error
      return res.json({
        intent: "advice",
        suggestions: ["Try '500 Coffee'", "Check Summary", "Wait a moment"],
        reply: "My AI brain is taking a quick break due to high traffic! For now, simple entries like '500 Petrol' still work, or you can check your summary."
      });
    }

    // Only log strictly unexpected errors as Critical
    if (errorStatus !== 401 && !isQuotaError) {
      console.error("Unexpected AI Error:", error);
    }

    res.status(errorStatus === 401 ? 401 : 500).json({ 
      error: errorStatus === 401 ? "AUTH_ERROR" : "AI_ERROR", 
      message: errorStatus === 401 ? "API Key Authentication failed." : "An unexpected AI error occurred.",
      details: error.message 
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
