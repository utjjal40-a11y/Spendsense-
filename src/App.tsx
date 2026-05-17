/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Send, 
  PieChart as PieChartIcon, 
  History, 
  Settings, 
  Plus, 
  Trash2, 
  Calendar, 
  TrendingUp, 
  Search, 
  Download, 
  AlertCircle,
  MessageSquare,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  PlusCircle,
  LogIn,
  LogOut,
  User as UserIcon,
  FileText,
  BarChart3,
  Share2,
  ChevronLeft,
  ChevronRight,
  Filter
} from "lucide-react";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  auth, 
  db, 
  googleProvider, 
  OperationType, 
  handleFirestoreError,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  getDocs
} from "./lib/firebase";
import { signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";

// ─── Constants ────────────────────────────────────────────────────────────────
const C = {
  bg: "#0a0f1e", 
  surface: "#111827", 
  card: "#161d2e", 
  border: "#1e2d45",
  accent: "#34d399", // Emerald 400
  accentDark: "#059669", // Emerald 600
  warn: "#f59e0b", 
  danger: "#ef4444", 
  purple: "#8b5cf6",
  text: "#e2e8f0", 
  muted: "#64748b", 
  wa: "#25d366", 
  waDark: "#128c7e",
  income: "#34d399",
  expense: "#f87171",
};

const CATEGORIES: Record<string, { icon: string; color: string; keywords: string[] }> = {
  Food:      { icon: "🛒", color: "#10b981", keywords: ["grocery","sabji","milk","supermarket"] },
  Transport: { icon: "🚗", color: "#3b82f6", keywords: ["petrol","fuel","uber","ola","metro","train"] },
  Utilities: { icon: "⚡", color: "#f59e0b", keywords: ["electricity","internet","wifi","recharge","jio"] },
  Health:    { icon: "💊", color: "#ec4899", keywords: ["medicine","doctor","hospital","clinic"] },
  Dining:    { icon: "🍕", color: "#ef4444", keywords: ["swiggy","zomato","restaurant","cafe"] },
  Shopping:  { icon: "🛍️", color: "#8b5cf6", keywords: ["amazon","flipkart","myntra","shopping"] },
  Education: { icon: "📚", color: "#06b6d4", keywords: ["school","college","fees","tuition","book"] },
  Finance:   { icon: "🏦", color: "#64748b", keywords: ["emi","loan","bank","sip","fd"] },
  Family:    { icon: "👨‍👩‍👧", color: "#f97316", keywords: ["mom","dad","rent","house"] },
  Salary:    { icon: "💰", color: "#34d399", keywords: ["salary","paycheck"] },
  Business:  { icon: "🏢", color: "#3b82f6", keywords: ["business","client","sales"] },
  Freelance: { icon: "💻", color: "#8b5cf6", keywords: ["freelance","gig","project"] },
  Investment:{ icon: "📈", color: "#10b981", keywords: ["dividend","profit","stocks"] },
  Gift:      { icon: "🎁", color: "#f472b6", keywords: ["gift","bonus"] },
  Other:     { icon: "📌", color: "#94a3b8", keywords: [] },
};

const BUDGET = 30000;

// ─── Types ──────────────────────────────────────────────────────────────────
interface Transaction {
  id: string;
  type: "income" | "expense";
  amount: number;
  description: string;
  category: string;
  date: string;
}

interface Message {
  id: string;
  from: "bot" | "user";
  text: string;
  timestamp: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatINR(n: number) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Fallback Parser for Offline Mode ─────────────────────────────────────────
function fallbackParseTransaction(text: string): { amount: number | null, description: string, category: string, type: "income" | "expense", tip: string } {
  const clean = text.trim();
  const incomeKeywords = ["salary", "earned", "received", "credited", "income", "profit", "sold", "gift", "freelance"];
  
  // Extract amount using regex
  const amountMatch = clean.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)/i);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;
  
  // Clean description (remove amount and currency)
  let description = clean.replace(/(?:₹|rs\.?|inr)?\s*\d+(?:\.\d+)?/i, "").trim();
  description = description.replace(/^(for|on|to|spent|paid|earned|received)\s+/i, "").trim();
  
  // Detect Type
  const isIncome = incomeKeywords.some(kw => clean.toLowerCase().includes(kw));
  const type: "income" | "expense" = isIncome ? "income" : "expense";
  
  // Detect Category from keywords
  let category = "Other";
  for (const [cat, data] of Object.entries(CATEGORIES)) {
    if (data.keywords.some(kw => clean.toLowerCase().includes(kw.toLowerCase()))) {
      category = cat;
      break;
    }
  }

  return {
    amount,
    description: description || (isIncome ? "Uncategorized Income" : "Uncategorized Expense"),
    category,
    type,
    tip: "Running in Offline Mode. Connect to the internet for smart AI saving tips!"
  };
}

// ─── Component: PieChart ──────────────────────────────────────────────────────
function SimplePieChart({ slices, size = 120 }: { slices: { value: number; color: string }[]; size?: number }) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  if (!total) return <div style={{ width: size, height: size, borderRadius: "50%", background: C.border }} />;
  
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  let angle = -90;
  
  const paths = slices.map((d, i) => {
    const sweep = (d.value / total) * 360;
    const a1 = (angle * Math.PI) / 180;
    const a2 = ((angle + sweep - 0.5) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const lg = sweep > 180 ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} Z`;
    angle += sweep;
    return <path key={i} d={path} fill={d.color} stroke={C.bg} strokeWidth={2} />;
  });
  
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
      <circle cx={cx} cy={cy} r={r * 0.55} fill={C.card} />
    </svg>
  );
}

// ─── Component: Main Application ────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({
    Food: 5000,
    Transport: 3000,
    Utilities: 2000,
    Health: 1000,
    Dining: 3000,
    Shopping: 5000,
    Education: 2000,
    Finance: 5000,
    Family: 2000,
    Other: 2000
  });
  
  const [messages, setMessages] = useState<Message[]>([{
    id: "welcome",
    from: "bot",
    timestamp: Date.now(),
    text: "👋 Hi! I'm your Finance AI.\n\nI understand **English, Hindi, and Assamese!**\n\nTry sending:\n- **500 for grocery**\n- **salary aayi 50000** (Hindi)\n- **দোকানত ৩০০ টকা খৰছ** (Assamese)\n- **chai break 20**",
  }]);

  const [modelFlavor, setModelFlavor] = useState<"gemini" | "gpt">("gemini");
  const [suggestions, setSuggestions] = useState<string[]>(["Spent 500 on dinner", "Today's summary", "Money saving tips"]);

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
  }, []);

  // Firestore Sync: Transactions
  useEffect(() => {
    if (!user) {
      setTransactions([]);
      return;
    }

    const q = query(
      collection(db, "users", user.uid, "transactions"),
      orderBy("date", "desc")
    );

    return onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Transaction[];
      setTransactions(txs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/transactions`);
    });
  }, [user]);

  // Firestore Sync: Messages
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "users", user.uid, "messages"),
      orderBy("timestamp", "asc")
    );

    return onSnapshot(q, (snapshot) => {
      if (snapshot.empty) return;
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/messages`);
    });
  }, [user]);

  // Firestore Sync: Budgets
  useEffect(() => {
    if (!user) return;

    const budgetDoc = doc(db, "users", user.uid, "config", "budgets");
    return onSnapshot(budgetDoc, (doc) => {
      if (doc.exists()) {
        setCategoryBudgets(doc.data().categoryBudgets);
      }
    });
  }, [user]);

  const login = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
      showToast("Signed in successfully!");
    } catch (error: any) {
      console.error("Login failed", error);
      if (error?.code === 'auth/cancelled-popup-request') {
        showToast("Sign-in process was already open. Please check other windows.", "warn");
      } else if (error?.code === 'auth/popup-closed-by-user') {
        showToast("Sign-in popup closed. Please try again.", "warn");
      } else {
        showToast("Sign in failed. Possible popup blocker.", "error");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    showToast("Signed out", "warn");
  };

  // WhatsApp Share Helper
  const shareToWhatsApp = () => {
    const period = reportRange === 'daily' ? 'Today' : 
                   reportRange === 'monthly' ? 'This Month' : 
                   reportRange === 'yearly' ? 'This Year' : 
                   `${startDate} to ${endDate}`;
    
    const filtered = transactions.filter(t => {
      const td = new Date(t.date);
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23,59,59,999);
      return td >= start && td <= end;
    });

    const income = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const net = income - expense;

    const text = `📊 *SpendSense Financial Report*\n` +
                 `📅 *Period:* ${period}\n\n` +
                 `📈 *Total Income:* ${formatINR(income)}\n` +
                 `📉 *Total Expense:* ${formatINR(expense)}\n` +
                 `⚖️ *Net Balance:* ${formatINR(net)}\n\n` +
                 `📝 *Top Items:*\n` +
                 filtered.slice(0, 5).map(t => `• ${t.description}: ${formatINR(t.amount)}`).join('\n') +
                 `\n\n_Generated via SpendSense AI_`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  // PDF Export Helper
  const exportPDF = () => {
    const doc = new jsPDF() as any;
    
    const period = reportRange === 'daily' ? 'Today' : 
                   reportRange === 'monthly' ? 'This Month' : 
                   reportRange === 'yearly' ? 'This Year' : 
                   `${startDate} to ${endDate}`;

    doc.setFontSize(22);
    doc.setTextColor(16, 185, 129); // Emerald 500
    doc.text('SpendSense Financial Report', 14, 20);
    
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Period: ${period}`, 14, 30);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 37);

    const filtered = transactions.filter(t => {
      const td = new Date(t.date);
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23,59,59,999);
      return td >= start && td <= end;
    });

    const income = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

    autoTable(doc, {
      startY: 45,
      head: [['Metric', 'Value']],
      body: [
        ['Total Income', formatINR(income)],
        ['Total Expense', formatINR(expense)],
        ['Net Savings', formatINR(income - expense)],
        ['Savings Rate', income > 0 ? `${((income - expense) / income * 100).toFixed(1)}%` : '0%']
      ],
      theme: 'striped',
      headStyles: { fillColor: [16, 185, 129] }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 15;
    
    // Add Insight
    doc.setFontSize(14);
    doc.setTextColor(51, 65, 85);
    doc.text('AI Financial Insight', 14, finalY);
    doc.setFontSize(10);
    doc.setTextColor(100);
    const avgSaving = (transactions.filter(t => t.type === 'income').reduce((s,t) => s+t.amount, 0) - transactions.filter(t => t.type === 'expense').reduce((s,t) => s+t.amount, 0)) / 6;
    const topCat = reportCategoryData[0]?.name || 'Unknown Categories';
    const insightText = `Based on your analysis, your average monthly saving rate is ${formatINR(avgSaving)}. You are spending most consistently on ${topCat}.`;
    const splitInsight = doc.splitTextToSize(insightText, 180);
    doc.text(splitInsight, 14, finalY + 10);

    doc.text('Transaction Details', 14, finalY + 30);

    autoTable(doc, {
      startY: finalY + 35,
      head: [['Date', 'Description', 'Category', 'Type', 'Amount']],
      body: filtered.map(t => [
        new Date(t.date).toLocaleDateString(),
        t.description,
        t.category,
        t.type.toUpperCase(),
        formatINR(t.amount)
      ]),
      theme: 'grid',
      headStyles: { fillColor: [51, 65, 85] }
    });

    doc.save(`SpendSense_Report_${period.replace(/ /g, '_')}.pdf`);
  };

  // Helper for consistent local date strings (YYYY-MM-DD)
  const getLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [input, setInput] = useState("");
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [selectedItemName, setSelectedItemName] = useState<string | null>(null);

  const shareItemToWhatsApp = (itemName: string) => {
    const related = transactions.filter(t => t.description.toLowerCase() === itemName.toLowerCase());
    const totalExp = related.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const totalInc = related.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);

    const text = `📊 *SpendSense Item Report: ${itemName}*\n\n` +
                 `📈 *Total Income:* ${formatINR(totalInc)}\n` +
                 `📉 *Total Expense:* ${formatINR(totalExp)}\n` +
                 `⚖️ *Net:* ${formatINR(totalInc - totalExp)}\n\n` +
                 `📝 *History:*\n` +
                 related.slice(0, 10).map(t => `• ${new Date(t.date).toLocaleDateString()}: ${formatINR(t.amount)} (${t.type})`).join('\n') +
                 `\n\n_Generated via SpendSense AI_`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const exportItemPDF = (itemName: string) => {
    const doc = new jsPDF() as any;
    const related = transactions.filter(t => t.description.toLowerCase() === itemName.toLowerCase());
    
    doc.setFontSize(20);
    doc.setTextColor(16, 185, 129);
    doc.text(`Item Analysis: ${itemName}`, 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 28);

    const totalExp = related.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const totalInc = related.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);

    autoTable(doc, {
      startY: 35,
      head: [['Metric', 'Value']],
      body: [
        ['Total Income', formatINR(totalInc)],
        ['Total Expense', formatINR(totalExp)],
        ['Net Balance', formatINR(totalInc - totalExp)],
        ['Transaction Count', related.length.toString()]
      ],
      theme: 'striped',
      headStyles: { fillColor: [16, 185, 129] }
    });

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [['Date', 'Time', 'Category', 'Type', 'Amount']],
      body: related.map(t => [
        new Date(t.date).toLocaleDateString(),
        new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        t.category,
        t.type.toUpperCase(),
        formatINR(t.amount)
      ]),
      theme: 'grid',
      headStyles: { fillColor: [51, 65, 85] }
    });

    doc.save(`SpendSense_${itemName.replace(/ /g, '_')}_Report.pdf`);
  };

  const [reportRange, setReportRange] = useState<"daily" | "monthly" | "yearly" | "custom">("monthly");
  const [startDate, setStartDate] = useState(getLocalDateString(new Date(new Date().setDate(1))));
  const [endDate, setEndDate] = useState(getLocalDateString(new Date()));
  const [activeTab, setActiveTab] = useState<"chat" | "stats" | "income" | "history" | "settings" | "reports">("chat");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "warn" } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  const saveMessage = async (msg: Omit<Message, 'id'>) => {
    if (!user) return;
    const { from, text, timestamp } = msg;
    try {
      await addDoc(collection(db, "users", user.uid, "messages"), {
        from,
        text,
        timestamp,
        userId: user.uid
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/messages`);
    }
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const showToast = (message: string, type: "success" | "error" | "warn" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const generateId = (prefix: string = "id") => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    
    setInput("");
    const userMsg: Message = { id: generateId("user"), from: "user", text, timestamp: Date.now() };
    if (user) {
      saveMessage(userMsg);
    } else {
      setMessages(prev => [...prev, userMsg]);
    }
    setLoading(true);

    let result;
    let usedAI = false;

    try {
      if (isOnline) {
        // Prepare context for the AI to answer data-related questions
        const transactionContext = {
          summary: {
            totalIncome: transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0),
            totalExpense: transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
            balance: transactions.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0),
            count: transactions.length
          },
          recent: transactions.slice(0, 15).map(t => ({
            date: t.date.split('T')[0],
            type: t.type,
            amount: t.amount,
            description: t.description,
            category: t.category
          })),
          topCategories: Object.keys(CATEGORIES).map(cat => ({
            name: cat,
            total: transactions.filter(t => t.category === cat && t.type === 'expense').reduce((s, t) => s + t.amount, 0)
          })).filter(c => c.total > 0).sort((a, b) => b.total - a.total).slice(0, 8)
        };

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            text, 
            current_date: new Date().toISOString(),
            model_flavor: modelFlavor,
            transaction_context: transactionContext
          }),
        });
        
        if (response.ok) {
          result = await response.json();
          usedAI = true;
          if (result.suggestions) setSuggestions(result.suggestions);
        } else if (response.status === 429) {
          const errData = await response.json();
          showToast(errData.message || "AI quota exceeded. Using local parser.", "warn");
        }
      }
    } catch (error) {
      console.warn("AI processing failed", error);
    }

    if (result && result.intent === "advice") {
      const botMsg: Omit<Message, 'id'> = {
        from: "bot",
        timestamp: Date.now(),
        text: result.reply || "I'm not sure about that."
      };
      if (user) {
        saveMessage(botMsg);
      } else {
        setMessages(prev => [...prev, { ...botMsg, id: generateId("bot") }]);
      }
    } else if (result && result.intent === "search") {
      let { category, start_date, end_date, aggregation, language } = result.search;
      
      // Validate dates or default to today if AI failed
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      
      if (!start_date || isNaN(Date.parse(start_date))) start_date = todayStr;
      if (!end_date || isNaN(Date.parse(end_date))) end_date = todayStr;

      const start = new Date(start_date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(end_date);
      end.setHours(23, 59, 59, 999);
      
      const filtered = transactions.filter(t => {
        const d = new Date(t.date);
        const matchDate = d >= start && d <= end;
        if (!matchDate) return false;
        if (category && t.category.toLowerCase() !== category.toLowerCase()) return false;
        return true;
      });

      const total = filtered.reduce((s, t) => s + (t.type === 'expense' ? t.amount : 0), 0);
      const incomeTotal = filtered.reduce((s, t) => s + (t.type === 'income' ? t.amount : 0), 0);
      
      // Readable period string
      let periodStr = "";
      if (start_date === end_date) {
        periodStr = start_date === todayStr ? "Today" : formatDate(start_date);
      } else {
        periodStr = `${formatDate(start_date)} - ${formatDate(end_date)}`;
      }

      let botResponse = "";
      if (aggregation === 'sum') {
        const catText = category ? `on *${category}*` : 'in total';
        if (language === 'hi') {
          botResponse = `आपने **${periodStr}** में ${category || 'कुल'} पर **${formatINR(total)}** खर्च किए।`;
        } else if (language === 'as') {
          botResponse = `আপুনি **${periodStr}** ত ${category || 'মুঠতে'} **${formatINR(total)}** খৰচ কৰিছে।`;
        } else {
          botResponse = `You spent **${formatINR(total)}** ${catText} during **${periodStr}**.`;
        }
      } else if (aggregation === 'average') {
        const avg = filtered.length ? total / filtered.length : 0;
        botResponse = `Your average spending ${category ? `on *${category}*` : ''} for this period was **${formatINR(avg)}** per transaction.`;
      } else {
        const list = filtered.slice(0, 15).map(t => {
          const d = new Date(t.date);
          return `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })} – **${formatINR(t.amount)}** – ${t.category}`;
        }).join('\n');
        
        const header = language === 'hi' ? `**${periodStr} के खर्चे:**` : language === 'as' ? `**${periodStr}ৰ খৰচ:**` : `**${periodStr} Expenses:**`;
        botResponse = `${header}\n\n${list || '_No expenses found_'}\n\n**Total: ${formatINR(total)}**`;
      }

      const botMsg: Omit<Message, 'id'> = {
        from: "bot",
        timestamp: Date.now(),
        text: botResponse
      };

      if (user) {
        saveMessage(botMsg);
      } else {
        setMessages(prev => [...prev, { ...botMsg, id: generateId("bot") }]);
      }
    } else {
      // Handle entry (either from AI or fallback)
      let data = (result && result.intent === 'entry') ? result.entry : null;
      
      if (!data) {
        data = fallbackParseTransaction(text);
      }

      if (data && data.amount) {
        const verb = data.type === 'income' ? 'earned' : 'spent';
        const cat = CATEGORIES[data.category] || CATEGORIES.Other;
        const msgText = `${cat.icon} **${data.category}** noted! You ${verb} **${formatINR(data.amount)}** on *${data.description}*.\n\n${usedAI ? '💡 Tip: ' + data.tip : '⚡ (Local Parser used)'}`;

        if (user) {
          try {
            await addDoc(collection(db, "users", user.uid, "transactions"), {
              userId: user.uid,
              type: data.type,
              amount: data.amount,
              description: data.description,
              category: data.category,
              date: new Date().toISOString()
            });
            await saveMessage({ from: "bot", timestamp: Date.now(), text: msgText });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/transactions`);
          }
        } else {
          const newTransaction: Transaction = {
            id: generateId("txn"),
            type: data.type,
            amount: data.amount,
            description: data.description,
            category: data.category,
            date: new Date().toISOString()
          };
          setTransactions(prev => [newTransaction, ...prev]);
          setMessages(prev => [...prev, {
            id: generateId("bot"),
            from: "bot",
            timestamp: Date.now(),
            text: msgText
          }]);
        }
        showToast(`Added ${formatINR(data.amount)} ${data.type}`);
      } else {
        const botMsg: Omit<Message, 'id'> = {
          from: "bot",
          timestamp: Date.now(),
          text: "I couldn't understand that. You can try:\n- **Spent 500 on dinner**\n- **How much did I spend on food?**\n- **Show January expenses**"
        };
        if (user) {
          saveMessage(botMsg);
        } else {
          setMessages(prev => [...prev, { ...botMsg, id: generateId("bot") }]);
        }
      }
    }
    
    setLoading(false);
  };

  const deleteTransaction = async (id: string) => {
    if (user) {
      try {
        await deleteDoc(doc(db, "users", user.uid, "transactions", id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/transactions/${id}`);
      }
    } else {
      setTransactions(prev => prev.filter(t => t.id !== id));
    }
    showToast("Transaction deleted", "warn");
  };

  const exportData = async () => {
    let dataToExport = transactions;
    if (user) {
      try {
        const querySnapshot = await getDocs(collection(db, "users", user.uid, "transactions"));
        dataToExport = querySnapshot.docs.map(doc => doc.data() as Transaction);
      } catch (e) {
        console.error("Export failed", e);
      }
    }
    if (dataToExport.length === 0) return showToast("No data to export", "error");
    const headers = ["Date", "Type", "Description", "Category", "Amount"];
    const rows = dataToExport.map(e => [formatDate(e.date), e.type, `"${e.description}"`, e.category, e.amount].join(","));
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "spend_sense_data.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Exported as CSV");
  };

  const [statsTimeframe, setStatsTimeframe] = useState<"today" | "selected" | "month" | "year" | "all" | "custom">("month");
  const [statsType, setStatsType] = useState<"all" | "income" | "expense">("all");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // Synchronize startDate/endDate with Stats filters
  useEffect(() => {
    const now = new Date();
    const todayStr = getLocalDateString(now);
    
    if (statsTimeframe === "today") {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (statsTimeframe === "selected") {
      setStartDate(selectedDate);
      setEndDate(selectedDate);
    } else if (statsTimeframe === "month") {
      const start = new Date(selectedYear, selectedMonth, 1);
      const last = new Date(selectedYear, selectedMonth + 1, 0);
      setStartDate(getLocalDateString(start));
      setEndDate(getLocalDateString(last));
    } else if (statsTimeframe === "year") {
      const start = new Date(selectedYear, 0, 1);
      const last = new Date(selectedYear, 11, 31);
      setStartDate(getLocalDateString(start));
      setEndDate(getLocalDateString(last));
    } else if (statsTimeframe === "all") {
      setStartDate("2000-01-01");
      setEndDate("2100-12-31");
    }
  }, [statsTimeframe, selectedMonth, selectedYear, selectedDate]);

  // Combined Filtering Logic for both Stats and Reports
  const reportTransactions = transactions.filter(t => {
    const tDate = new Date(t.date);
    const start = new Date(startDate);
    start.setHours(0,0,0,0);
    const end = new Date(endDate);
    end.setHours(23,59,59,999);
    
    // 1. Filter by Type (Stats specific)
    if (statsType !== "all" && t.type !== statsType) return false;

    // 2. Date Range Filter
    if (tDate < start || tDate > end) return false;

    return true; 
  });

  const reportStats = {
    total: reportTransactions.reduce((sum, t) => sum + t.amount, 0),
    income: reportTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0),
    expense: reportTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0),
    count: reportTransactions.length
  };

  const isViewingToday = startDate === getLocalDateString(new Date()) && endDate === getLocalDateString(new Date());

  const reportCategoryData = Object.keys(CATEGORIES).map(cat => ({
    name: cat,
    total: reportTransactions.filter(e => e.category === cat).reduce((sum, e) => sum + e.amount, 0),
    color: CATEGORIES[cat].color,
    icon: CATEGORIES[cat].icon
  })).filter(c => c.total > 0).sort((a,b) => b.total - a.total);

  // General Stats (Used in header/balance)
  const today = new Date();
  const isFirstOfMonth = today.getDate() === 1;

  const monthExp = transactions.filter(e => e.type === 'expense' && new Date(e.date).getMonth() === selectedMonth && new Date(e.date).getFullYear() === selectedYear).reduce((sum, e) => sum + e.amount, 0);
  const monthInc = transactions.filter(e => e.type === 'income' && new Date(e.date).getMonth() === selectedMonth && new Date(e.date).getFullYear() === selectedYear).reduce((sum, e) => sum + e.amount, 0);

  const BALANCE_BUDGET = (Object.values(categoryBudgets) as number[]).reduce((a, b) => a + b, 0);
  const balance = monthInc - monthExp;
  const budgetUsed = Math.min(100, (monthExp / (BALANCE_BUDGET || 1)) * 100);

  const categoryData = Object.keys(CATEGORIES).map(cat => ({
    name: cat,
    total: transactions.filter(e => e.type === 'expense' && e.category === cat && new Date(e.date).getMonth() === selectedMonth && new Date(e.date).getFullYear() === selectedYear).reduce((sum, e) => sum + e.amount, 0),
    budget: categoryBudgets[cat] || 0,
    color: CATEGORIES[cat].color,
    icon: CATEGORIES[cat].icon
  })).filter(c => c.total > 0 || c.budget > 0).sort((a,b) => b.total - a.total);

  const filteredTransactions = transactions
    .filter(e => filterCategory === "All" || e.category === filterCategory)
    .filter(e => {
      const desc = e.description || "";
      const cat = e.category || "";
      return desc.toLowerCase().includes(searchQuery.toLowerCase()) || 
             cat.toLowerCase().includes(searchQuery.toLowerCase());
    });

  const incomes = transactions.filter(t => t.type === 'income');
  const expenses = transactions.filter(t => t.type === 'expense');

  return (
    <div className="flex flex-col lg:flex-row h-screen max-w-md lg:max-w-6xl mx-auto relative shadow-2xl overflow-hidden" style={{ backgroundColor: C.bg, color: C.text }}>
      
      {/* Sidebar for Desktop */}
      <aside className="hidden lg:flex flex-col w-64 border-r overflow-y-auto" style={{ borderColor: C.border, backgroundColor: C.surface }}>
        <div className="p-6 border-b" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-emerald-900 shadow-lg">
              <MessageSquare size={16} />
            </div>
            <h1 className="text-lg font-black tracking-tight text-white leading-tight">SpendSense</h1>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          {[
            { id: 'chat', label: 'AI Assistant', icon: <MessageSquare size={18} /> },
            { id: 'stats', label: 'Analytics', icon: <PieChartIcon size={18} /> },
            { id: 'reports', label: 'Reports', icon: <FileText size={18} /> },
            { id: 'income', label: 'Royalties & Income', icon: <ArrowUpCircle size={18} /> },
            { id: 'history', label: 'Transaction Logs', icon: <History size={18} /> },
            { id: 'settings', label: 'Admin Settings', icon: <Settings size={18} /> }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === tab.id 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
              }`}
            >
              {tab.icon}
              <span className="text-sm font-bold">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t" style={{ borderColor: C.border }}>
           <div className="bg-slate-800/40 p-4 rounded-2xl border border-slate-700/50">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Current Balance</p>
              <p className={`text-xl font-black ${balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatINR(balance)}</p>
              <div className="mt-4 space-y-1">
                <div className="flex justify-between text-[10px] font-bold">
                  <span className="text-slate-500 uppercase">Budget Used</span>
                  <span className="text-slate-300">{budgetUsed.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${budgetUsed}%` }} />
                </div>
              </div>
           </div>
        </div>
      </aside>

      <AnimatePresence>
        {selectedItemName && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedItemName(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-slate-900 border border-slate-800 rounded-[32px] w-full max-w-sm overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="px-6 py-5 bg-gradient-to-r from-emerald-500/20 to-emerald-500/5 border-b border-emerald-500/10 flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-black text-white capitalize">{selectedItemName}</h3>
                  <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mt-0.5">Item Performance Profile</p>
                </div>
                <button 
                  onClick={() => setSelectedItemName(null)}
                  className="p-2 rounded-full bg-black/20 text-emerald-400 hover:bg-black/40 transition-colors"
                >
                  <ChevronLeft size={20} className="rotate-180" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {(() => {
                  const related = transactions.filter(t => t.description.toLowerCase() === selectedItemName.toLowerCase());
                  const totalExp = related.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
                  const totalInc = related.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
                  
                  return (
                    <>
                      {/* Item Stats Matrix */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                          <p className="text-[10px] font-black text-rose-500/70 uppercase tracking-widest mb-1">Total Spent</p>
                          <p className="text-xl font-black text-white">{formatINR(totalExp)}</p>
                        </div>
                        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                          <p className="text-[10px] font-black text-emerald-500/70 uppercase tracking-widest mb-1">Total Earned</p>
                          <p className="text-xl font-black text-white">{formatINR(totalInc)}</p>
                        </div>
                      </div>

                      {/* Transaction List */}
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">Transaction History</h4>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                          {related.map(t => (
                            <div key={t.id} className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/30 border border-slate-800/50">
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs ${t.type === 'expense' ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                  {new Date(t.date).getDate()}
                                </div>
                                <div>
                                  <p className="text-xs font-bold text-slate-200">
                                    {new Date(t.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </p>
                                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-tight">
                                    {new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {t.category}
                                  </p>
                                </div>
                              </div>
                              <span className={`text-xs font-black ${t.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'}`}>
                                {t.type === 'expense' ? '-' : '+'}{formatINR(t.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Action Matrix */}
                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <button 
                          onClick={() => shareItemToWhatsApp(selectedItemName)}
                          className="flex items-center justify-center gap-2 bg-emerald-500 text-slate-900 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform"
                        >
                          <Share2 size={16} />
                          Share WhatsApp
                        </button>
                        <button 
                          onClick={() => exportItemPDF(selectedItemName)}
                          className="flex items-center justify-center gap-2 bg-slate-800 text-white border border-slate-700 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest active:scale-95 transition-transform"
                        >
                          <Download size={16} />
                          Extract PDF
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 20, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="fixed top-0 left-0 right-0 z-50 flex justify-center px-4"
          >
            <div 
              className="px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2"
              style={{ 
                backgroundColor: toast.type === 'error' ? C.danger : toast.type === 'warn' ? C.warn : C.accent,
                color: '#fff'
              }}
            >
              {toast.type === 'error' && <AlertCircle size={14} />}
              {toast.message}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="px-5 py-4 pb-6 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${C.waDark}, #0a4f41)` }}>
        <div className="flex justify-between items-center relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-400 flex items-center justify-center text-xl shadow-lg shadow-emerald-900/40">
              <MessageSquare className="text-emerald-900" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white leading-tight">SpendSense</h1>
              <div className="flex items-center gap-1.5 leading-none">
                <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <p className="text-[10px] text-emerald-200 uppercase tracking-widest font-bold opacity-80">
                  {isOnline ? (user ? `Hi, ${user.displayName?.split(' ')[0]}` : 'Connected to AI') : 'Offline Mode'}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
               <button onClick={logout} className="p-2 rounded-full bg-black/20 text-emerald-100 hover:bg-black/40 transition-colors">
                <LogOut size={16} />
              </button>
            ) : (
              <button 
                onClick={login} 
                disabled={isLoggingIn || authLoading}
                className="p-2 rounded-full bg-black/20 text-emerald-400 hover:bg-black/40 transition-colors border border-emerald-400/30 disabled:opacity-50"
              >
                <LogIn size={16} />
              </button>
            )}
            <div className="text-right hidden sm:block">
              <p className="text-[10px] text-emerald-100/60 font-bold uppercase">Budget Utilized</p>
              <p className={`text-sm font-black ${budgetUsed > 90 ? 'text-rose-300' : 'text-emerald-300'}`}>{budgetUsed.toFixed(0)}%</p>
            </div>
          </div>
        </div>

        {/* Floating Bubble Background Effect */}
        <div className="absolute top-[-20%] right-[-10%] w-32 h-32 bg-white/5 rounded-full blur-2xl" />
        <div className="absolute bottom-[-30%] left-[-10%] w-24 h-24 bg-emerald-300/10 rounded-full blur-xl" />
      </header>

      {/* Navigation Tabs */}
      <nav className="flex border-b" style={{ borderColor: C.border, backgroundColor: C.surface }}>
        {[
          { id: 'chat', label: 'Chat', icon: <MessageSquare size={16} /> },
          { id: 'stats', label: 'Stats', icon: <PieChartIcon size={16} /> },
          { id: 'reports', label: 'Report', icon: <BarChart3 size={16} /> },
          { id: 'income', label: 'In', icon: <ArrowUpCircle size={16} /> },
          { id: 'history', label: 'Logs', icon: <History size={16} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 py-3 flex flex-col items-center gap-1 transition-all relative ${activeTab === tab.id ? 'text-emerald-400' : 'text-slate-500'}`}
          >
            {tab.icon}
            <span className="text-[9px] font-bold uppercase tracking-wider">{tab.label}</span>
            {activeTab === tab.id && (
              <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400" />
            )}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-hidden relative">
        
        {/* Chat Section */}
        <AnimatePresence mode="wait">
          {activeTab === "chat" && (
            <motion.div 
              key="chat"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              className="flex flex-col h-full bg-slate-950/40"
            >
              <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl shadow-md text-sm leading-relaxed ${
                      msg.from === 'user' 
                        ? 'bg-emerald-600 text-white rounded-br-sm' 
                        : 'bg-slate-800 text-slate-200 rounded-bl-sm border border-slate-700'
                    }`}>
                      <div className="whitespace-pre-wrap break-words">
                        {msg.text.split('\n').map((line, i) => {
                          // Simple bold parsing
                          const parts = line.split(/(\*\*.*?\*\*)/g);
                          return (
                            <p key={i}>
                              {parts.map((part, pi) => 
                                part.startsWith('**') && part.endsWith('**') 
                                  ? <strong key={pi} className="font-bold text-white">{part.slice(2, -2)}</strong> 
                                  : part
                              )}
                            </p>
                          );
                        })}
                      </div>
                      <div className={`text-[9px] mt-1.5 opacity-60 flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-800 border border-slate-700 px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1.5">
                      <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 0.6 }} className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                      <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                      <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Quick Suggestions */}
              <div className="px-4 py-2 flex gap-2 overflow-x-auto no-scrollbar whitespace-nowrap bg-slate-900/50 border-t border-slate-800/50">
                {suggestions.map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => {
                        setInput(suggestion);
                        // Trigger send immediately for better UX
                        setTimeout(() => handleSend(), 100);
                    }}
                    className="text-[10px] px-3 py-1.5 rounded-full border bg-slate-800 text-emerald-400/80 border-slate-700 hover:border-emerald-500 transition-colors animate-in fade-in slide-in-from-left-2"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              {/* Login State Prompt */}
              {!user && !authLoading && messages.length > 3 && (
                <div className="px-4 py-3 bg-indigo-950/30 border-y border-indigo-500/20 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <History size={14} className="text-indigo-400" />
                    <p className="text-[10px] font-bold text-indigo-200">Sign in to save your history permanently</p>
                  </div>
                  <button 
                    onClick={login}
                    disabled={isLoggingIn}
                    className="px-3 py-1 bg-indigo-500 text-white text-[10px] font-black uppercase rounded-lg active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {isLoggingIn ? 'Wait...' : 'Connect'}
                  </button>
                </div>
              )}

              {/* Chat Input */}
              <div className="p-4 bg-slate-900 border-t border-slate-800 flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="e.g. Spent 500 on coffee"
                  className="flex-1 bg-slate-800 border-none rounded-full px-5 py-3 text-sm focus:ring-2 focus:ring-emerald-500/50 outline-none transition-all placeholder:text-slate-600"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                    input.trim() && !loading ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 active:scale-90' : 'bg-slate-800 text-slate-600'
                  }`}
                >
                  <Send size={18} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Reports Section */}
          {activeTab === "reports" && (
            <motion.div 
              key="reports"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              className="h-full overflow-y-auto p-4 space-y-6 bg-slate-950/20"
            >
              <div className="flex justify-between items-center px-1 pt-2">
                <div>
                  <h2 className="text-2xl font-black text-white">Financial Reports</h2>
                  <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mt-0.5">Deep Data Extraction</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={shareToWhatsApp}
                    className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all shadow-lg"
                    title="Share to WhatsApp"
                  >
                    <Share2 size={18} />
                  </button>
                  <button 
                    onClick={exportPDF}
                    className="p-2.5 rounded-xl bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 transition-colors shadow-lg"
                    title="Download PDF"
                  >
                    <Download size={18} />
                  </button>
                </div>
              </div>

              {/* Date Filter Matrix */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Report Range Control</h3>
                  <Filter size={14} className="text-slate-600" />
                </div>
                
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'daily', label: 'Daily', statsId: 'today' },
                    { id: 'monthly', label: 'Monthly', statsId: 'month' },
                    { id: 'yearly', label: 'Yearly', statsId: 'year' },
                    { id: 'custom', label: 'Custom Range', statsId: 'custom' }
                  ].map(range => (
                    <button
                      key={range.id}
                      onClick={() => {
                        setReportRange(range.id as any);
                        setStatsTimeframe(range.statsId as any);
                      }}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                        reportRange === range.id 
                          ? 'bg-emerald-500 text-white shadow-emerald-500/20 shadow-lg' 
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>

                {reportRange === 'custom' && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase px-1">From</label>
                      <input 
                        type="date" 
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase px-1">To</label>
                      <input 
                        type="date" 
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Financial Performance Table */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
                {(() => {
                  const filtered = reportTransactions;
                  const inc = reportStats.income;
                  const exp = reportStats.expense;
                  const net = inc - exp;
                  const isToday = startDate === getLocalDateString(new Date()) && endDate === getLocalDateString(new Date());
                  
                  return (
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none">Net Savings</p>
                            {isToday && (
                              <span className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tighter border border-emerald-500/20">
                                <span className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse" />
                                Live Today
                              </span>
                            )}
                          </div>
                          <p className={`text-2xl font-black ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatINR(net)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-tight">Period Volume</p>
                          <p className="text-sm font-black text-white">{filtered.length} txns</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-2xl">
                          <p className="text-[9px] font-black text-emerald-500/70 uppercase tracking-widest">Total Income</p>
                          <p className="text-base font-black text-emerald-400">{formatINR(inc)}</p>
                        </div>
                        <div className="bg-rose-500/5 border border-rose-500/10 p-3 rounded-2xl">
                          <p className="text-[9px] font-black text-rose-500/70 uppercase tracking-widest">Total Expense</p>
                          <p className="text-base font-black text-rose-400">{formatINR(exp)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Item-wise Search Matrix */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
                <div className="flex flex-col gap-2">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Item-wise Analysis</h3>
                  <div className="relative group">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-emerald-400 transition-colors" size={16} />
                    <input 
                      type="text" 
                      placeholder="Search specific item (e.g. Coffee)..."
                      value={itemSearchQuery}
                      onChange={(e) => setItemSearchQuery(e.target.value)}
                      className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl py-3 pl-11 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/5 transition-all"
                    />
                  </div>
                </div>

                {itemSearchQuery.trim() ? (
                  <div className="space-y-3 pt-2">
                    {(() => {
                      const filtered = transactions.filter(t => 
                        t.description.toLowerCase().includes(itemSearchQuery.toLowerCase())
                      );
                      const totalExp = filtered.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
                      const totalInc = filtered.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
                      
                      if (filtered.length === 0) {
                        return <p className="text-[10px] text-slate-500 font-bold text-center py-2">No items found matching "{itemSearchQuery}"</p>;
                      }

                      return (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/50">
                              <p className="text-[9px] font-black text-rose-500/70 uppercase tracking-widest">Total Spent</p>
                              <p className="text-sm font-black text-white">{formatINR(totalExp)}</p>
                            </div>
                            <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/50">
                              <p className="text-[9px] font-black text-emerald-500/70 uppercase tracking-widest">Total Earned</p>
                              <p className="text-sm font-black text-white">{formatINR(totalInc)}</p>
                            </div>
                          </div>
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {filtered.slice(0, 8).map(t => (
                              <button 
                                key={t.id} 
                                onClick={() => setSelectedItemName(t.description)}
                                className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-800/30 border border-slate-800/50 hover:bg-slate-800/50 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-sm">{CATEGORIES[t.category as keyof typeof CATEGORIES]?.icon || '📦'}</span>
                                  <div className="text-left">
                                    <p className="text-[10px] font-bold text-slate-200 leading-none">{t.description}</p>
                                    <p className="text-[8px] text-slate-500">{new Date(t.date).toLocaleDateString()}</p>
                                  </div>
                                </div>
                                <span className={`text-[10px] font-black ${t.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'}`}>
                                  {t.type === 'expense' ? '-' : '+'}{formatINR(t.amount)}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="pt-2">
                    <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-3">Top Recurring Items</p>
                    <div className="space-y-2">
                      {(() => {
                        const itemMap: { [key: string]: { total: number, count: number, type: string } } = {};
                        transactions.forEach(t => {
                          const key = `${t.description.toLowerCase()}-${t.type}`;
                          if (!itemMap[key]) itemMap[key] = { total: 0, count: 0, type: t.type };
                          itemMap[key].total += t.amount;
                          itemMap[key].count += 1;
                        });
                        return Object.entries(itemMap)
                          .sort((a,b) => b[1].total - a[1].total)
                          .slice(0, 5)
                          .map(([key, data]) => {
                             const name = key.split('-')[0];
                             return (
                               <button 
                                 key={key} 
                                 onClick={() => setSelectedItemName(name)}
                                 className="w-full flex items-center justify-between p-3 rounded-2xl bg-slate-950/40 border border-slate-800/50 hover:bg-slate-800/60 transition-colors"
                               >
                                 <div className="text-left">
                                   <p className="text-xs font-black text-white capitalize">{name}</p>
                                   <p className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">{data.count} Transactions</p>
                                 </div>
                                 <div className="text-right">
                                   <p className={`text-xs font-black ${data.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'}`}>
                                     {data.type === 'expense' ? '-' : '+'}{formatINR(data.total)}
                                   </p>
                                 </div>
                               </button>
                             );
                          });
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* Monthly Overview Table - The "Report Column" View */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
                <div className="px-5 py-4 border-b border-slate-800 bg-slate-800/30">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Monthly Performance Table</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="px-5 py-4 text-[9px] font-black uppercase tracking-widest text-slate-500">Period</th>
                        <th className="px-5 py-4 text-[9px] font-black uppercase tracking-widest text-emerald-500">Income</th>
                        <th className="px-5 py-4 text-[9px] font-black uppercase tracking-widest text-rose-500">Expense</th>
                        <th className="px-5 py-4 text-[9px] font-black uppercase tracking-widest text-blue-400">Savings %</th>
                        <th className="px-5 py-4 text-[9px] font-black uppercase tracking-widest text-slate-300 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {[...Array(6)].map((_, i) => {
                        const d = new Date();
                        d.setMonth(d.getMonth() - i);
                        const m = d.getMonth();
                        const y = d.getFullYear();
                        
                        const mTransactions = transactions.filter(t => {
                          const td = new Date(t.date);
                          return td.getMonth() === m && td.getFullYear() === y;
                        });
                        
                        const mInc = mTransactions.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
                        const mExp = mTransactions.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
                        const mNet = mInc - mExp;
                        const savingsPct = mInc > 0 ? ((mInc - mExp) / mInc) * 100 : 0;
                        
                        if (mInc === 0 && mExp === 0) return null;
                        
                        return (
                          <tr key={`${m}-${y}`} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-5 py-4">
                              <p className="text-xs font-black text-slate-200">{["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]}</p>
                              <p className="text-[9px] text-slate-600 font-bold">{y}</p>
                            </td>
                            <td className="px-5 py-4">
                              <p className="text-xs font-bold text-emerald-400">{formatINR(mInc)}</p>
                            </td>
                            <td className="px-5 py-4">
                              <p className="text-xs font-bold text-rose-400">{formatINR(mExp)}</p>
                            </td>
                            <td className="px-5 py-4">
                              <p className={`text-xs font-bold ${savingsPct > 20 ? 'text-blue-400' : 'text-slate-500'}`}>
                                {savingsPct > 0 ? `${savingsPct.toFixed(0)}%` : '--'}
                              </p>
                            </td>
                            <td className="px-5 py-4 text-right">
                              <p className={`text-xs font-black ${mNet >= 0 ? 'text-white' : 'text-rose-500'}`}>
                                {mNet < 0 ? '-' : ''}{formatINR(Math.abs(mNet))}
                              </p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Category Matrix */}
              <div className="space-y-3">
                 <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600 px-2">Category Spending Matrix</h3>
                 <div className="grid grid-cols-2 gap-3">
                   {reportCategoryData.slice(0, 6).map(c => (
                     <div key={c.name} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xl">{c.icon}</span>
                          <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Share: {((c.total/reportStats.expense)*100).toFixed(0)}%</span>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{c.name}</p>
                          <p className="text-base font-black text-white">{formatINR(c.total)}</p>
                        </div>
                        <div className="h-1 w-full bg-slate-800 rounded-full mt-1 overflow-hidden">
                           <div className="h-full transition-all" style={{ width: `${(c.total/reportStats.expense)*100}%`, backgroundColor: c.color }} />
                        </div>
                     </div>
                   ))}
                 </div>
              </div>

              {/* Summary Insight Card */}
              <div className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-3xl relative overflow-hidden">
                <div className="relative z-10">
                  <h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-2">Automatic Financial Insight</h3>
                  <p className="text-xs text-emerald-100/70 leading-relaxed italic">
                    "Based on your last 6 months, your average monthly saving rate is **{formatINR((transactions.filter(t => t.type === 'income').reduce((s,t) => s+t.amount, 0) - transactions.filter(t => t.type === 'expense').reduce((s,t) => s+t.amount, 0)) / 6)}**. You are spending most consistently on **{reportCategoryData[0]?.name || 'Unknown Categories'}**."
                  </p>
                </div>
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <FileText size={48} />
                </div>
              </div>
              
              <div className="pb-10" />
            </motion.div>
          )}

          {/* Stats Section */}
          {activeTab === "stats" && (
            <motion.div 
              key="stats"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              className="h-full overflow-y-auto p-4 space-y-4 bg-slate-950/20"
            >
              {/* Stats Section Header */}
              <div className="flex justify-between items-center px-1">
                <h2 className="text-xl font-black text-white">Analysis</h2>
                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border ${isOnline ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  <span className="text-[9px] font-black uppercase tracking-widest">{isOnline ? 'AI Live' : 'Local'}</span>
                </div>
              </div>

              {/* Type and Timeframe Selectors */}
              <div className="space-y-3">
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {[
                    { id: 'all', label: 'Overview' },
                    { id: 'income', label: 'Revenue' },
                    { id: 'expense', label: 'Spending' }
                  ].map(type => (
                    <button
                      key={type.id}
                      onClick={() => setStatsType(type.id as any)}
                      className={`text-[10px] font-bold px-4 py-1.5 rounded-full border transition-all whitespace-nowrap ${
                        statsType === type.id 
                          ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg' 
                          : 'bg-slate-900 border-slate-800 text-slate-500'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>

                <div className="bg-slate-900/50 border border-slate-800/50 p-1 rounded-xl flex">
                  {[
                    { id: 'today', label: 'Today' },
                    { id: 'selected', label: 'Date' },
                    { id: 'month', label: 'Monthly' },
                    { id: 'year', label: 'Yearly' },
                    { id: 'all', label: 'Total' }
                  ].map(timer => (
                    <button
                      key={timer.id}
                      onClick={() => {
                        setStatsTimeframe(timer.id as any);
                        // Map to Report Range for UI sync
                        if (timer.id === 'today') setReportRange('daily');
                        else if (timer.id === 'month') setReportRange('monthly');
                        else if (timer.id === 'year') setReportRange('yearly');
                        else setReportRange('custom');
                      }}
                      className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                        statsTimeframe === timer.id 
                          ? 'bg-slate-800 text-emerald-400 shadow-inner' 
                          : 'text-slate-600'
                      }`}
                    >
                      {timer.label}
                    </button>
                  ))}
                </div>

                {(statsTimeframe === "month" || statsTimeframe === "year") && (
                  <div className="flex gap-2 px-1">
                    <select 
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-[10px] font-bold text-white outline-none"
                    >
                      {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => (
                        <option key={m} value={i}>{m}</option>
                      ))}
                    </select>
                    <select 
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-[10px] font-bold text-white outline-none"
                    >
                      {[2023, 2024, 2025, 2026].map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                )}

                {statsTimeframe === "selected" && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="px-1">
                    <input 
                      type="date" 
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:ring-1 focus:ring-emerald-500/40 outline-none"
                    />
                  </motion.div>
                )}
              </div>

              {/* Balance & Distribution Card */}
              <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-800 p-6 rounded-3xl shadow-xl relative overflow-hidden">
                <div className="relative z-10">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400/60 mb-1">
                    Net Balance ({statsTimeframe})
                  </h3>
                  <p className={`text-3xl font-black ${reportStats.income - reportStats.expense >= 0 ? 'text-white' : 'text-rose-400'}`}>
                    {reportStats.income - reportStats.expense < 0 ? '-' : ''}{formatINR(Math.abs(reportStats.income - reportStats.expense))}
                  </p>
                  
                  <div className="flex gap-4 mt-6">
                    <div className="flex-1 relative">
                      <div className="flex items-center gap-1.5 text-emerald-400 mb-0.5">
                        <ArrowUpCircle size={10} />
                        <span className="text-[9px] font-black uppercase tracking-widest">Income</span>
                      </div>
                      <p className="text-base font-black">{formatINR(reportStats.income)}</p>
                      {isViewingToday && (
                        <div className="absolute top-0 right-0 w-1 h-1 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                      )}
                    </div>
                    <div className="w-px bg-slate-700/50" />
                    <div className="flex-1 relative">
                      <div className="flex items-center gap-1.5 text-rose-400 mb-0.5">
                        <ArrowDownCircle size={10} />
                        <span className="text-[9px] font-black uppercase tracking-widest">Spend</span>
                      </div>
                      <p className="text-base font-black">{formatINR(reportStats.expense)}</p>
                      {isViewingToday && (
                        <div className="absolute top-0 right-0 w-1 h-1 bg-rose-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
                      )}
                    </div>
                  </div>
                </div>
                <div className="absolute top-[-20%] right-[-10%] w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl" />
              </div>

              {/* Category Breakdown with Progress Bars */}
              {statsType !== 'income' && (
                <div className="space-y-3">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-2 mt-4">Budget Utilization ({statsTimeframe})</h3>
                  {categoryData.filter(c => c.budget > 0).map(c => {
                    // Re-calculate the specific current view spend for this category to show in bar
                    const currentViewCatTotal = reportTransactions.filter(t => t.type === 'expense' && t.category === c.name).reduce((sum, t) => sum + t.amount, 0);
                    const pct = Math.min(100, (currentViewCatTotal / c.budget) * 100);
                    
                    return (
                      <div key={c.name} className="bg-slate-900/40 border border-slate-800/40 p-4 rounded-2xl">
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{c.icon}</span>
                            <span className="text-xs font-bold">{c.name}</span>
                          </div>
                          <span className="text-xs font-black text-slate-300">
                            {formatINR(currentViewCatTotal)} <span className="text-slate-600 font-normal">/ {formatINR(c.budget)}</span>
                          </span>
                        </div>
                        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full rounded-full transition-all duration-1000" 
                            style={{ 
                              width: `${pct}%`, 
                              backgroundColor: pct > 90 ? C.danger : pct > 70 ? C.warn : c.color 
                            }} 
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Visual Category Mix */}
              {reportCategoryData.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex items-center gap-8">
                  <div className="flex-shrink-0">
                    <SimplePieChart slices={reportCategoryData.map(c => ({ value: c.total, color: c.color }))} size={110} />
                  </div>
                  <div className="flex-1 space-y-2.5">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 underline decoration-emerald-500/30 underline-offset-4">Asset Allocation</h3>
                    {reportCategoryData.slice(0, 5).map(c => (
                      <div key={c.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                          <span className="text-xs text-slate-400 truncate max-w-[80px]">{c.name}</span>
                        </div>
                        <span className="text-xs font-black text-slate-200">{formatINR(c.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Month-wise History Summary */}
              <div className="space-y-3 pb-8">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-2 mt-6">Historical Comparison</h3>
                {[...Array(6)].map((_, i) => {
                  const d = new Date();
                  d.setMonth(d.getMonth() - i);
                  const m = d.getMonth();
                  const y = d.getFullYear();
                  
                  const mTransactions = transactions.filter(t => {
                    const td = new Date(t.date);
                    return td.getMonth() === m && td.getFullYear() === y;
                  });
                  
                  const mInc = mTransactions.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
                  const mExp = mTransactions.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
                  
                  if (mInc === 0 && mExp === 0) return null;
                  
                  return (
                    <button 
                      key={`${m}-${y}`} 
                      onClick={() => {
                        setSelectedMonth(m);
                        setSelectedYear(y);
                        setStatsTimeframe('month');
                        showToast(`Viewing ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} ${y}`);
                      }}
                      className={`w-full bg-slate-900/40 border border-slate-800 p-4 rounded-2xl flex justify-between items-center hover:bg-slate-800/60 transition-colors ${selectedMonth === m && selectedYear === y ? 'ring-1 ring-emerald-500/50' : ''}`}
                    >
                      <div className="text-left">
                        <p className="text-xs font-black text-slate-200">{["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} {y}</p>
                        <p className="text-[9px] text-slate-500 font-bold uppercase">{mTransactions.length} Operations</p>
                      </div>
                      <div className="flex gap-4 text-right">
                        <div>
                          <p className="text-[9px] text-emerald-400/60 font-black uppercase">In</p>
                          <p className="text-xs font-black text-emerald-400">{formatINR(mInc)}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-rose-400/60 font-black uppercase">Out</p>
                          <p className="text-xs font-black text-rose-400">{formatINR(mExp)}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* Income Tab */}
          {activeTab === "income" && (
            <motion.div 
              key="income"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              className="h-full flex flex-col bg-slate-950/20"
            >
              <div className="p-6 bg-slate-900/50 border-b border-slate-800">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-2xl font-black text-white">Income</h2>
                    <p className="text-xs text-emerald-400 font-bold uppercase tracking-widest">Earnings Manager</p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                    <Wallet size={24} />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Total MTD</span>
                    <p className="text-xl font-black text-emerald-400">{formatINR(monthInc)}</p>
                  </div>
                   <button 
                    onClick={() => setActiveTab('chat')}
                    className="p-4 rounded-2xl bg-emerald-500 text-slate-900 flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform"
                  >
                    <PlusCircle size={20} />
                    <span className="text-[10px] font-black uppercase">Add Income</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600 px-2 mt-2">Recent Earnings</h3>
                {incomes.length > 0 ? (
                  incomes.map((inc) => {
                    const cat = CATEGORIES[inc.category] || CATEGORIES.Other;
                    return (
                      <div key={inc.id} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center text-xl shrink-0">
                          {cat.icon}
                        </div>
                        <div className="flex-1">
                          <h4 className="text-sm font-bold">{inc.description}</h4>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{inc.category} • {formatDate(inc.date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-emerald-400">+{formatINR(inc.amount)}</p>
                          <button onClick={() => deleteTransaction(inc.id)} className="text-slate-600 hover:text-rose-500 mt-1"><Trash2 size={12} /></button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-12 text-center text-slate-600">
                    <p className="text-sm">No income recorded yet.</p>
                    <p className="text-[10px] mt-1 font-bold uppercase tracking-widest opacity-40">Add your first paycheck in chat</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* History Section */}
          {activeTab === "history" && (
            <motion.div 
              key="history"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              className="h-full flex flex-col bg-slate-950/20"
            >
              <div className="p-4 space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search logs..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500/40 outline-none"
                  />
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {["All", ...Object.keys(CATEGORIES)].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className={`text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all whitespace-nowrap ${
                        filterCategory === cat 
                          ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
                          : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600'
                      }`}
                    >
                      {cat !== 'All' && <span className="mr-1">{CATEGORIES[cat].icon}</span>}
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2.5">
                {filteredTransactions.length > 0 ? (
                  filteredTransactions.map((transaction) => {
                    const cat = CATEGORIES[transaction.category] || CATEGORIES.Other;
                    const isIncome = transaction.type === 'income';
                    return (
                      <motion.button 
                        layout
                        key={transaction.id} 
                        onClick={() => setSelectedItemName(transaction.description)}
                        className="w-full bg-slate-900 border border-slate-800 p-3 rounded-2xl flex items-center gap-3 active:scale-[0.98] hover:bg-slate-800/50 transition-all text-left"
                      >
                        <div 
                          className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                          style={{ backgroundColor: isIncome ? `${C.income}20` : `${cat.color}20`, color: isIncome ? C.income : cat.color }}
                        >
                          {isIncome ? <Plus size={18} /> : cat.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold truncate text-slate-100">{transaction.description}</h4>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{transaction.category} • {formatDate(transaction.date)}</p>
                        </div>
                        <div className="text-right flex flex-col items-end gap-1">
                          <p className={`text-sm font-black ${isIncome ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isIncome ? '+' : '-'}{formatINR(transaction.amount)}
                          </p>
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteTransaction(transaction.id);
                            }}
                            className="p-1 text-rose-500 hover:bg-rose-500/10 rounded-md transition-colors"
                          >
                            <Trash2 size={12} />
                          </div>
                        </div>
                      </motion.button>
                    );
                  })
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-700 py-12">
                    <History size={48} className="opacity-10 mb-4" />
                    <p className="text-sm font-bold uppercase tracking-widest opacity-40">No Logs Found</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Settings Section */}
          {activeTab === "settings" && (
            <motion.div 
              key="settings"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              className="h-full overflow-y-auto p-5 space-y-6 bg-slate-950/20"
            >
              {isFirstOfMonth && (
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-emerald-500/20 border border-emerald-500/40 p-4 rounded-3xl flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center text-slate-900 shrink-0">
                    <Calendar size={24} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-emerald-400 uppercase tracking-widest">1st of the Month!</h4>
                    <p className="text-[10px] text-emerald-200/80 leading-tight">It's time to allocate your budget for new operations. Plan wisely!</p>
                  </div>
                </motion.div>
              )}

              <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center">
                  <h3 className="text-xs font-black uppercase tracking-widest text-emerald-400">Account Overview</h3>
                  <div className="flex gap-1">
                     <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-bold">
                       {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][selectedMonth]} {selectedYear}
                     </span>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-bold">Total Operations</span>
                    <span className="text-sm font-black text-white">{reportTransactions.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-bold">Total Month Income</span>
                    <span className="text-sm font-black text-emerald-400">{formatINR(monthInc)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-bold">Total Month Spent</span>
                    <span className="text-sm font-black text-rose-400">{formatINR(monthExp)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-bold">Total Budget Limit</span>
                    <span className="text-sm font-black text-white">{formatINR(BALANCE_BUDGET)}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600 px-2">AI Configuration</h3>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-200">AI Personality</span>
                    <span className="text-[10px] text-slate-500 font-medium">Choose between Gemini and ChatGPT flavor</span>
                  </div>
                  <div className="flex bg-slate-950 p-1 rounded-xl gap-1">
                    <button 
                      onClick={() => setModelFlavor("gemini")}
                      className={`px-3 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${modelFlavor === 'gemini' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-600 hover:text-slate-400'}`}
                    >
                      Gemini
                    </button>
                    <button 
                      onClick={() => setModelFlavor("gpt")}
                      className={`px-3 py-1.5 text-[10px] font-black uppercase rounded-lg transition-all ${modelFlavor === 'gpt' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-slate-600 hover:text-slate-400'}`}
                    >
                      GPT
                    </button>
                  </div>
                </div>
              </div>

              {/* Category Budget Manager */}
              <div className="space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600 px-2">Manage Category Budgets</h3>
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 space-y-4">
                  {Object.keys(CATEGORIES).filter(cat => !['Salary', 'Business', 'Freelance', 'Investment', 'Gift'].includes(cat)).map(cat => (
                    <div key={cat} className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <span>{CATEGORIES[cat].icon}</span>
                        <span className="text-xs font-bold text-slate-300">{cat}</span>
                      </div>
                      <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">₹</span>
                        <input 
                          type="number"
                          value={categoryBudgets[cat] || ""}
                          onChange={async (e) => {
                            const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                            const updated = { ...categoryBudgets, [cat]: val };
                            setCategoryBudgets(updated);
                            if (user) {
                              try {
                                await setDoc(doc(db, "users", user.uid, "config", "budgets"), {
                                  categoryBudgets: updated
                                });
                              } catch (e) {
                                console.error("Failed to save budget", e);
                              }
                            }
                          }}
                          placeholder="0"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-6 pr-3 py-2 text-xs text-emerald-400 font-bold focus:ring-1 focus:ring-emerald-500/50 outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600 px-2">Data Management</h3>
                <div className="flex gap-3">
                  <button 
                    onClick={shareToWhatsApp}
                    className="flex-1 bg-emerald-500 border border-emerald-400 p-4 rounded-2xl flex items-center justify-between hover:bg-emerald-600 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <MessageSquare size={18} className="text-white" />
                      <span className="text-sm font-bold text-white">Share to WhatsApp</span>
                    </div>
                  </button>
                  <button 
                    onClick={exportData}
                    className="flex-1 bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between hover:border-emerald-500 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <Download size={18} className="text-emerald-400" />
                      <span className="text-sm font-bold text-slate-200">Export (CSV)</span>
                    </div>
                  </button>
                </div>
                <button 
                  onClick={() => {
                    const sample: Transaction[] = [
                      { id: '1', type: 'expense', amount: 500, description: "Office Lunch", category: "Dining", date: new Date().toISOString() },
                      { id: '2', type: 'expense', amount: 2000, description: "Monthly Groceries", category: "Food", date: new Date().toISOString() },
                      { id: '3', type: 'expense', amount: 1500, description: "Petrol for Bike", category: "Transport", date: new Date().toISOString() },
                      { id: '4', type: 'income', amount: 55000, description: "Monthly Salary", category: "Salary", date: new Date().toISOString() }
                    ];
                    setTransactions(sample);
                    showToast("Sample data loaded");
                  }}
                  className="w-full bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between hover:border-blue-500 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <Calendar size={18} className="text-blue-400" />
                    <span className="text-sm font-bold text-slate-200">Load Sample Data</span>
                  </div>
                  <Plus size={16} className="text-slate-600 group-hover:text-blue-400" />
                </button>
                <button 
                  onClick={() => {
                    if (confirm("Are you sure you want to delete all your history?")) {
                      if (user) {
                        // Deleting entire collection from client is tricky, usually done via cloud functions or loop.
                        // For simplicity, we warn the user or provide a helper. 
                        // Let's just point them to account settings or clear local if they are anonymous.
                        showToast("Please contact support to delete cloud data.", "warn");
                      } else {
                        setTransactions([]);
                        setMessages([]);
                        showToast("Local data cleared", "error");
                      }
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between hover:border-rose-500 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <Trash2 size={18} className="text-rose-500" />
                    <span className="text-sm font-bold text-slate-200">Delete All History</span>
                  </div>
                  <Trash2 size={16} className="text-slate-600 group-hover:text-rose-500" />
                </button>
              </div>

              <div className="bg-emerald-950/20 border border-emerald-500/20 p-5 rounded-3xl">
                <h4 className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <TrendingUp size={14} /> WhatsApp Coming Soon
                </h4>
                <p className="text-[11px] text-emerald-200/60 leading-relaxed">
                  In future updates, you'll be able to link your WhatsApp Business account and send expenses directly via text.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      </div>

      {/* Floating Action Button (only in Chat for quick shortcuts or something) - Removed for cleaner UI if not needed */}
    </div>
  );
}
