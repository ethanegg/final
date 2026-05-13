const http = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const ROOT = __dirname;
loadEnv(path.join(ROOT, ".env"));

const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.resolve(ROOT, process.env.DATA_FILE || "./data/localbuilt.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);

const storeTemplate = {
  quoteRequests: [],
  roiReports: [],
  prospectSearches: [],
  generatedEmails: [],
  contactRequests: [],
  newsletterSubscribers: [],
};

const rateBuckets = new Map();

function loadEnv(filePath) {
  if (!fsSync.existsSync(filePath)) return;
  const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function cleanText(value, max = 500) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value) {
  return !value || /^[0-9+().\-\s]{7,24}$/.test(value);
}

function ensureAllowed(value, allowed, fallback = "") {
  return allowed.includes(value) ? value : fallback;
}

function normalizeArray(value, allowed) {
  const arr = Array.isArray(value) ? value : [];
  return [...new Set(arr.map((item) => ensureAllowed(item, allowed)).filter(Boolean))];
}

function baseErrors(body) {
  const errors = [];
  if (cleanText(body.website, 100)) errors.push("Spam check failed.");
  return errors;
}

function validateContactRequest(body) {
  const errors = baseErrors(body);
  const value = {
    name: cleanText(body.name, 100),
    email: cleanEmail(body.email),
    phone: cleanText(body.phone, 30),
    businessName: cleanText(body.businessName, 120),
    message: cleanText(body.message, 1200),
  };

  if (value.name.length < 2) errors.push("Name is required.");
  if (!isEmail(value.email)) errors.push("A valid email is required.");
  if (!isPhone(value.phone)) errors.push("Phone number is invalid.");
  if (value.message.length < 10) errors.push("Message must be at least 10 characters.");

  return { ok: errors.length === 0, errors, value };
}

function validateNewsletter(body) {
  const errors = baseErrors(body);
  const value = { email: cleanEmail(body.email), source: cleanText(body.source || "footer", 60) };
  if (!isEmail(value.email)) errors.push("A valid email is required.");
  return { ok: errors.length === 0, errors, value };
}

function validateQuoteRequest(body) {
  const errors = baseErrors(body);
  const value = {
    businessType: ensureAllowed(body.businessType, ["restaurant", "salon", "trades", "retail", "medical", "fitness", "other"]),
    currentPresence: ensureAllowed(body.currentPresence, ["nothing", "facebook", "oldsite", "google"]),
    needs: normalizeArray(body.needs, ["website", "google", "seo", "booking", "reviews", "maintenance"]),
    pageCount: ensureAllowed(body.pageCount, ["3", "5", "10", "na"]),
    maintenance: ensureAllowed(body.maintenance, ["none", "basic", "standard", "full"]),
    name: cleanText(body.name, 100),
    email: cleanEmail(body.email),
    phone: cleanText(body.phone, 30),
    businessName: cleanText(body.businessName, 120),
  };

  if (!value.businessType) errors.push("Choose a business type.");
  if (!value.currentPresence) errors.push("Choose your current online presence.");
  if (!value.needs.length) errors.push("Choose at least one service.");
  if (value.needs.includes("website") && !value.pageCount) errors.push("Choose a page count.");
  if (value.needs.includes("maintenance") && !value.maintenance) errors.push("Choose a maintenance option.");
  if (value.name.length < 2) errors.push("Name is required.");
  if (!isEmail(value.email)) errors.push("A valid email is required.");
  if (!isPhone(value.phone)) errors.push("Phone number is invalid.");

  return { ok: errors.length === 0, errors, value };
}

function validateRoiReport(body) {
  const errors = baseErrors(body);
  const value = {
    businessName: cleanText(body.businessName, 120),
    averageSpend: Number(body.averageSpend),
    monthlyCustomers: Number(body.monthlyCustomers),
    currentWebsite: ensureAllowed(body.currentWebsite, ["none", "old", "basic", "good"]),
    email: cleanEmail(body.email),
  };

  if (!Number.isFinite(value.averageSpend) || value.averageSpend <= 0) errors.push("Average spend must be greater than 0.");
  if (!Number.isFinite(value.monthlyCustomers) || value.monthlyCustomers <= 0) errors.push("Monthly customers must be greater than 0.");
  if (!value.currentWebsite) errors.push("Choose your current website status.");
  if (value.email && !isEmail(value.email)) errors.push("Email is invalid.");

  return { ok: errors.length === 0, errors, value };
}

function validateProspectSearch(body) {
  const errors = baseErrors(body);
  const value = {
    city: cleanText(body.city, 100),
    niche: ensureAllowed(body.niche, ["restaurant", "salon", "plumber", "gym", "dentist", "retail"]),
    email: cleanEmail(body.email),
  };
  if (value.city.length < 2) errors.push("City or area is required.");
  if (!value.niche) errors.push("Choose a niche.");
  if (value.email && !isEmail(value.email)) errors.push("Email is invalid.");
  return { ok: errors.length === 0, errors, value };
}

function validateGeneratedEmail(body) {
  const errors = baseErrors(body);
  const value = {
    businessName: cleanText(body.businessName, 120),
    businessType: ensureAllowed(body.businessType, ["restaurant", "salon", "plumber", "gym", "dentist", "other"], "other"),
    problem: ensureAllowed(body.problem, ["nosite", "nobook", "nogoogle", "noreviews"]),
  };
  if (value.businessName.length < 2) errors.push("Business name is required.");
  if (!value.problem) errors.push("Choose the problem to highlight.");
  return { ok: errors.length === 0, errors, value };
}

function calculatePrice(value) {
  let setupTotal = 0;
  const breakdown = [];

  if (value.needs.includes("website")) {
    const pages = { "3": 399, "5": 599, "10": 899, na: 0 }[value.pageCount] || 0;
    setupTotal += pages;
    if (pages) breakdown.push({ label: "Website build", amount: pages });
  }
  if (value.needs.includes("google")) {
    const amount = ["nothing", "facebook"].includes(value.currentPresence) ? 249 : 149;
    setupTotal += amount;
    breakdown.push({ label: "Google Business setup", amount });
  }
  if (value.needs.includes("seo")) {
    setupTotal += 550;
    breakdown.push({ label: "Local SEO foundation", amount: 550 });
  }
  if (value.needs.includes("booking")) {
    const amount = ["restaurant", "medical", "fitness"].includes(value.businessType) ? 299 : 199;
    setupTotal += amount;
    breakdown.push({ label: "Online booking flow", amount });
  }
  if (value.needs.includes("reviews")) {
    setupTotal += 149;
    breakdown.push({ label: "Review request system", amount: 149 });
  }

  const monthly = { none: 0, basic: 150, standard: 300, full: 600 }[value.maintenance] || 0;
  return { setupTotal, monthly, breakdown };
}

function calculateRoi(value) {
  const multipliers = { none: 0.18, old: 0.12, basic: 0.08, good: 0.04 };
  const monthlyRevenue = value.averageSpend * value.monthlyCustomers;
  const estimatedMonthlyLoss = Math.round(monthlyRevenue * (multipliers[value.currentWebsite] || 0.08));
  return {
    monthlyRevenue: Math.round(monthlyRevenue),
    estimatedMonthlyLoss,
    estimatedAnnualLoss: estimatedMonthlyLoss * 12,
  };
}

function generateProspects(value) {
  const labels = { restaurant: "restaurant", salon: "salon", plumber: "plumber", gym: "gym", dentist: "dentist", retail: "retail shop" };
  const label = labels[value.niche] || "business";
  const q = encodeURIComponent(`${label} ${value.city}`);
  return {
    profiles: [
      { name: "No website, active Google listing", indicators: "Google profile, phone only, few recent updates", badge: "Best Target" },
      { name: "Facebook page only", indicators: "Posts exist, no owned website, limited booking options", badge: "High Value" },
      { name: "Outdated desktop-only site", indicators: "Poor mobile layout, no conversion path", badge: "Strong Case" },
    ],
    links: [
      { label: `Google Maps: ${label}s in ${value.city}`, url: `https://www.google.com/maps/search/${q}` },
      { label: `Yelp: ${label}s in ${value.city}`, url: `https://www.yelp.com/search?find_desc=${encodeURIComponent(label)}&find_loc=${encodeURIComponent(value.city)}` },
      { label: `Google search: ${label} call us ${value.city}`, url: `https://www.google.com/search?q=${encodeURIComponent(`${label} "${value.city}" "call us"`)}` },
    ],
  };
}

function generateEmail(value) {
  const typeLabels = { restaurant: "restaurant", salon: "salon", plumber: "plumbing business", gym: "gym", dentist: "dental practice", other: "local business" };
  const problemCopy = {
    nosite: "I searched for you online and could not find a website, which makes it harder for new customers to trust and contact you.",
    nobook: "I could not find a simple way to book online, which means interested customers have to call during business hours.",
    nogoogle: "Your Google presence looks thin, so nearby customers may be finding competitors first.",
    noreviews: "Your review presence could be stronger, and reviews are often the first trust signal customers check.",
  };
  const type = typeLabels[value.businessType] || "local business";
  const subject = `Quick question about ${value.businessName}'s online presence`;
  const body = `Hi there,\n\nMy name is [Your Name]. I run LocalBuilt, a Boston-based web development agency that helps local businesses get found online.\n\nI came across ${value.businessName} and noticed something worth flagging: ${problemCopy[value.problem]}\n\nWe build websites, booking flows, and Google Business profiles specifically for ${type}s. Most projects are live within 7 days with a clear one-time setup cost.\n\nWould you be open to a quick 10-minute call this week? I can walk you through exactly what it would look like for ${value.businessName}.\n\n(617) 800-5560\nLocalBuilt`;
  return { subject, body };
}

async function readStore() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return { ...storeTemplate, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { ...storeTemplate };
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, DATA_FILE);
}

async function appendRecord(collection, payload, req) {
  const store = await readStore();
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ipHash: crypto.createHash("sha256").update(getIp(req)).digest("hex").slice(0, 16),
    ...payload,
  };
  store[collection].unshift(record);
  store[collection] = store[collection].slice(0, 1000);
  await writeStore(store);
  return record;
}

function getIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function rateLimit(req) {
  const key = getIp(req);
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { resetAt: now + RATE_LIMIT_WINDOW_MS, count: 0 };
  if (now > bucket.resetAt) {
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
    bucket.count = 0;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count <= RATE_LIMIT_MAX;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(ALLOWED_ORIGIN ? { "Access-Control-Allow-Origin": ALLOWED_ORIGIN } : {}),
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error("Payload too large.");
  }
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    throw error;
  }
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      ...(ALLOWED_ORIGIN ? { "Access-Control-Allow-Origin": ALLOWED_ORIGIN } : {}),
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/admin/submissions" && req.method === "GET") {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) return sendJson(res, 401, { error: "Unauthorized." });
    return sendJson(res, 200, await readStore());
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  if (!rateLimit(req)) return sendJson(res, 429, { error: "Too many requests. Please try again soon." });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON payload." });
  }

  const routes = {
    "/api/contact-requests": async () => {
      const result = validateContactRequest(body);
      if (!result.ok) return sendJson(res, 422, { errors: result.errors });
      const record = await appendRecord("contactRequests", { data: result.value }, req);
      return sendJson(res, 201, { id: record.id, message: "Thanks. We received your message and will follow up shortly." });
    },
    "/api/newsletter": async () => {
      const result = validateNewsletter(body);
      if (!result.ok) return sendJson(res, 422, { errors: result.errors });
      const record = await appendRecord("newsletterSubscribers", { data: result.value }, req);
      return sendJson(res, 201, { id: record.id, message: "You're on the list." });
    },
    "/api/quote-requests": async () => {
      const result = validateQuoteRequest(body);
      if (!result.ok) return sendJson(res, 422, { errors: result.errors });
      const estimate = calculatePrice(result.value);
      const record = await appendRecord("quoteRequests", { data: result.value, estimate }, req);
      return sendJson(res, 201, { id: record.id, estimate, message: "Quote saved. We will confirm the details with you." });
    },
    "/api/roi-reports": async () => {
      const result = validateRoiReport(body);
      if (!result.ok) return sendJson(res, 422, { errors: result.errors });
      const report = calculateRoi(result.value);
      const record = await appendRecord("roiReports", { data: result.value, report }, req);
      return sendJson(res, 201, { id: record.id, report });
    },
    "/api/prospect-searches": async () => {
      const result = validateProspectSearch(body);
      if (!result.ok) return sendJson(res, 422, { errors: result.errors });
      const prospects = generateProspects(result.value);
      const record = await appendRecord("prospectSearches", { data: result.value, prospects }, req);
      return sendJson(res, 201, { id: record.id, prospects });
    },
    "/api/generated-emails": async () => {
      const result = validateGeneratedEmail(body);
      if (!result.ok) return sendJson(res, 422, { errors: result.errors });
      const email = generateEmail(result.value);
      const record = await appendRecord("generatedEmails", { data: result.value, email }, req);
      return sendJson(res, 201, { id: record.id, email });
    },
  };

  if (!routes[url.pathname]) return sendJson(res, 404, { error: "API route not found." });
  return routes[url.pathname]();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong." });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`LocalBuilt running at http://localhost:${PORT}`);
  });
}

module.exports = {
  server,
  validateContactRequest,
  validateQuoteRequest,
  calculatePrice,
  calculateRoi,
};
