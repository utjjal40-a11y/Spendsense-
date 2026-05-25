import { GoogleGenAI, Type } from "@google/genai";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

function parseLocally(text: string, context?: any) {
  const t = text.toLowerCase();

  // 0. Greetings
  const greetings = ["hi", "hello", "hey", "namaste", "namaskar", "oi", "kiba", "ki khobor", "halo"];
  if (greetings.some(g => t.startsWith(g)) && t.length < 15) {
    return {
      intent: "advice",
      suggestions: ["Add 500 Food", "Check summary", "Set budget"],
      reply: "🛡️ Shield AI here! I can help you track expenses in English, Hindi, and Assamese. Try: 'Today 500 Food' or 'Summary dekhao'."
    };
  }

  // 1. Check for Summary/Search intent first
  const searchKeywords = ["summary", "report", "history", "total", "balance", "search", "find", "how much", "spent", "earned", "hisaab", "hishab", "kharch", "income", "dekha", "shao", "balance", "kiman"];
  const isFollowUp = t.includes("and for") || t.includes("what about") || t.includes("for ") && t.split(" ").length < 4;
  
  if ((searchKeywords.some(kw => t.includes(kw)) && !t.match(/\d+/)) || isFollowUp) {
    let reply = "Shield Summary:";
    
    // Attempt detailed item search if context is provided
    let itemQuery = "";
    if (t.includes("on ")) itemQuery = t.split("on ")[1]?.trim();
    else if (t.includes("for ")) itemQuery = t.split("for ")[1]?.trim();
    else if (t.includes("find ")) itemQuery = t.split("find ")[1]?.trim();
    else if (t.includes("search ")) itemQuery = t.split("search ")[1]?.replace("search", "").trim();
    else if (isFollowUp && t.includes("for ")) itemQuery = t.split("for ")[1]?.trim();

    if (itemQuery && context?.recent) {
       const filtered = context.recent.filter((tr: any) => 
         tr.description.toLowerCase().includes(itemQuery.toLowerCase()) || 
         tr.category.toLowerCase().includes(itemQuery.toLowerCase())
       );
       const isIncomeSearch = t.includes("earned") || t.includes("income") || t.includes("mila") || t.includes("kamaya") || t.includes("palo") || t.includes("paisa");
       const type = isIncomeSearch ? "income" : "expense";
       const relevantFiltered = filtered.filter((f: any) => f.type === type);
       const relevantTotal = relevantFiltered.reduce((s: number, tr: any) => s + tr.amount, 0);

       if (filtered.length > 0) {
         return {
           intent: "advice",
           suggestions: ["Full History", "Add Transaction", "Set Goal"],
           reply: `Found ${filtered.length} entries for "${itemQuery}". Total ${type === 'income' ? 'income' : 'expense'} is ₹${relevantTotal.toFixed(2)}.`
         };
       }
    }

    if (context?.summary) {
      reply = `🛡️ SHIELD STATUS:
Balance: ₹${context.summary.balance.toFixed(2)}
Income: ₹${context.summary.totalIncome}
Spent: ₹${context.summary.totalExpense}`;
    }
    return {
      intent: "advice",
      suggestions: ["Show recent", "Categories", "Add 200 Tea"],
      reply: `${reply}`
    };
  }

  // 2. Check for entry intent
  const amountRegex = /(\d+(\.\d+)?)/;
  const match = text.match(amountRegex);
  if (match) {
    const amount = parseFloat(match[1]);
    const cleanText = text.replace(match[1], '').trim();
    const remaining = cleanText.toLowerCase();
    
    const categoryMap: { [key: string]: string[] } = {
       "Food": ["food", "lunch", "dinner", "breakfast", "swiggy", "zomato", "grocery", "groceries", "eat", "restaurant", "tea", "chai", "coffee", "milk", "khana", "nasta", "cha", "sabji", "egg", "chicken", "mach", "maas", "bhat", "mithai"],
       "Transport": ["transport", "petrol", "fuel", "diesel", "auto", "cab", "uber", "ola", "bus", "train", "metro", "parking", "gaadi", "bhara", "yatra", "safar", "ticket", "tel", "ghura", "bike"],
       "Utilities": ["utilities", "bill", "electricity", "water", "gas", "recharge", "mobile", "internet", "wifi", "rent", "bijli", "makan", "kiraya", "phone", "ghor", "line", "broadband", "current"],
       "Health": ["health", "medicine", "doctor", "hospital", "clinic", "pharmacy", "medical", "dawai", "osudh", "daba", "med"],
       "Shopping": ["shopping", "amazon", "flipkart", "clothes", "shoes", "gift", "kapda", "kapor", "dress", "mall"],
       "Education": ["education", "school", "college", "fees", "book", "course", "tuition", "padhai", "porha", "exam"],
       "Finance": ["finance", "loan", "emi", "interest", "tax", "insurance", "bank", "udhar", "kisthi", "invest"],
       "Family": ["family", "house", "home", "kids", "wife", "mom", "dad", "maa", "papa", "baccha", "ghor", "poriyal"],
       "Salary": ["salary", "pay", "income", "stipend", "mahina", "tankha", "darmoha", "beton", "paisa"],
       "Freelance": ["freelance", "project", "gig", "client", "kaam", "kam", "work"],
       "Investment": ["investment", "stock", "mutual fund", "crypto", "gold", "bachat", "fd", "sip", "groww"],
       "Gift": ["gift", "present", "birthday", "uphaar", "dan", "sagoon"]
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
                    remaining.includes("mila") ||
                    remaining.includes("milal") ||
                    remaining.includes("kamaya") ||
                    remaining.includes("kamalu") ||
                    remaining.includes("palo") ||
                    remaining.includes("paisu") ||
                    remaining.includes("ahil") ||
                    remaining.includes("aya") ||
                    remaining.includes("jama") ||
                    remaining.includes("bonus") ||
                    remaining.includes("stipend") ||
                    remaining.includes("labh") ||
                    remaining.includes("darmoha") ||
                    remaining.includes("tankha") ||
                    remaining.includes("pay") ||
                    remaining.includes("paisa");

    const isExpense = remaining.includes("spent") ||
                     remaining.includes("kharch") ||
                     remaining.includes("khoros") || 
                     remaining.includes("khors") ||
                     remaining.includes("gol") || 
                     remaining.includes("diya") ||
                     remaining.includes("dila") ||
                     remaining.includes("bhara") ||
                     remaining.includes("kharida") ||
                     remaining.includes("lowa") ||
                     remaining.includes("lole") ||
                     remaining.includes("paid") ||
                     remaining.includes("purchase") ||
                     remaining.includes("bought") ||
                     remaining.includes("expense");

    return {
      intent: "entry",
      entry: {
        type: (isIncome && !isExpense) ? "income" : "expense",
        amount: amount,
        description: cleanText || foundCategory,
        category: foundCategory,
        tip: "Shield recorded your transaction (Local Mode)."
      },
      suggestions: ["Check balance", "Show reports", "Add more"],
      reply: `🛡️ Shield logged ₹${amount} for ${cleanText || foundCategory}.`
    };
  }

  // 3. General Fallback
  return {
    intent: "advice",
    suggestions: ["Add 500 Food", "Check summary", "Show balance"],
    reply: "I identified your message, but Shield AI is currently resting. Try something like 'Spent 500 for dinner' or 'Check balance'."
  };
}

// API endpoint to process messages
app.post("/api/chat", async (req, res) => {
  const { text, transaction_context } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: [{ role: "user", parts: [{ text: text }] }],
      config: {
        systemInstruction: `You are 'Shield AI', a financial assistant for a personal finance app.
Your core mission is to categorize transactions and provide financial insights.

LANGUAGE SUPPORT:
- You MUST understand English, Hindi, and Assamese.
- You MUST understand Hindi and Assamese even when written in ROMAN SCRIPT (English typing / Transliteration). 
  Example Hindi: "Aaj 500 khana pe kharch hua", "Mene 1000 rupaye kamaye", "500 rupaye rent diya".
  Example Assamese: "Moi 200 taka kamalu", "Ajir kharch 500 taka", "Tea t 20 taka gol".
- Respond in a natural, helpful way, preferably matching the user's language style or script.

INTENTS:
1. "entry": Use this when the user is reporting a new transaction (income or expense).
   - Extract: amount, type (income/expense), category, and description.
   - Categories MUST be one of: Food, Transport, Utilities, Health, Shopping, Education, Finance, Family, Salary, Freelance, Investment, Gift, Other.
2. "advice": Use this for everything else - greeting, balance inquiries, reports, or general financial advice.

TRANSACTION CONTEXT:
Total Income: ₹${transaction_context?.summary?.totalIncome || 0}
Total Expenses: ₹${transaction_context?.summary?.totalExpense || 0}
Current Balance: ₹${transaction_context?.summary?.balance || 0}
Recent Transactions: ${JSON.stringify(transaction_context?.recent || [])}

OUTPUT FORMAT:
Return ONLY a JSON object:
{
  "intent": "entry" | "advice",
  "entry": { "amount": number, "type": "income" | "expense", "category": "string", "description": "string", "tip": "Short encouraging tip" } (only if entry),
  "reply": "Your response text",
  "suggestions": ["3 short follow-up prompts"]
}`,
        responseMimeType: "application/json",
      }
    });

    const result = JSON.parse(response.text || "{}");
    res.json(result);
  } catch (error: any) {
    const isQuotaError = 
      error.status === 429 || 
      error.code === 429 || 
      error.message?.includes("429") || 
      error.message?.includes("RESOURCE_EXHAUSTED");

    if (!isQuotaError) {
      console.error("AI Chat major failure:", error);
    }
    
    // Fallback to local parser if AI fails (e.g., quota)
    const result = parseLocally(text, transaction_context);
    return res.json({ ...result, _quota: isQuotaError });
  }
});

app.post("/api/suggest-budget", async (req, res) => {
  const { category, transactions } = req.body;

  if (!category || !transactions) {
    return res.status(400).json({ error: "Category and transactions are required" });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: [{ role: "user", parts: [{ text: `Generate a budget for "${category}" based on these transactions: ${JSON.stringify(transactions.slice(-50))}` }] }],
      config: {
        systemInstruction: `You are a financial planning expert.
Current date: ${new Date().toISOString()}

TASK:
Analyze the historical transactions for a specific category and suggest a sensible monthly budget. 
Consider trends (increasing or decreasing spending) and add a roughly 10-15% safety buffer.

OUTPUT FORMAT:
Return ONLY a JSON object:
{ "suggestedAmount": number, "reasoning": "Quick summary of why" }`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestedAmount: { type: Type.NUMBER },
            reasoning: { type: Type.STRING }
          },
          required: ["suggestedAmount", "reasoning"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    res.json(result);
  } catch (error: any) {
    const isQuotaError = 
      error.status === 429 || 
      error.code === 429 || 
      error.message?.includes("429") || 
      error.message?.includes("RESOURCE_EXHAUSTED");

    if (isQuotaError) {
      // Local calculation fallback for budget
      const categoryTransactions = transactions.filter((t: any) => t.category === category);
      const totalAmount = categoryTransactions.reduce((s: number, t: any) => s + t.amount, 0);
      const avg = categoryTransactions.length > 0 ? totalAmount / categoryTransactions.length : 0;
      
      return res.json({ 
        suggestedAmount: Math.round(avg * 1.15) || 5000, 
        reasoning: "Suggested based on your recent activity average + 15% buffer (Shield Local)." 
      });
    }

    console.error("AI Suggestion failed:", error);
    res.status(500).json({ error: "AI suggestion failed" });
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
