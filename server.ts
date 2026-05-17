import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// API endpoint to parse transactions
app.post("/api/parse-transaction", async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Extract transaction details (income or expense) from this message: "${text}"`,
      config: {
        systemInstruction: "You are a multilingual personal finance assistant fluent in English, Hindi (Devanagari and Romanized), and Assamese (Assamese script and Romanized). Determine if the transaction is an income or an expense. Extract the amount, description (in English or Romanized), and category. Return ONLY JSON.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: ["income", "expense"], description: "Whether this is an income or an expense transaction." },
            amount: { type: Type.NUMBER, description: "The numerical amount. Null if not detectable." },
            description: { type: Type.STRING, description: "A brief, clean description of the transaction." },
            category: { 
              type: Type.STRING, 
              enum: ["Food", "Transport", "Utilities", "Health", "Dining", "Shopping", "Education", "Finance", "Family", "Salary", "Business", "Freelance", "Investment", "Gift", "Other"],
              description: "The most appropriate category." 
            },
            tip: { type: Type.STRING, description: "A very short, friendly finance tip related to this transaction." }
          },
          required: ["type", "description", "category", "tip"]
        },
      },
    });

    const result = JSON.parse(response.text || "{}");
    res.json(result);
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Failed to parse transaction" });
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
