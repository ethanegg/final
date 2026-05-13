const assert = require("node:assert/strict");
const { validateContactRequest, validateQuoteRequest, calculatePrice, calculateRoi } = require("../server");

const validContact = validateContactRequest({
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "617-800-5560",
  businessName: "Ada Cafe",
  message: "I need a website and booking setup.",
  website: "",
});

assert.equal(validContact.ok, true);

const spamContact = validateContactRequest({
  name: "",
  email: "bad",
  phone: "",
  businessName: "",
  message: "hi",
  website: "bot-filled-this",
});

assert.equal(spamContact.ok, false);
assert.ok(spamContact.errors.length >= 3);

const quote = validateQuoteRequest({
  businessType: "restaurant",
  currentPresence: "facebook",
  needs: ["website", "google", "booking", "maintenance"],
  pageCount: "5",
  maintenance: "standard",
  name: "Mario",
  email: "mario@example.com",
  phone: "6178005560",
  businessName: "Mario's Pizza",
  website: "",
});

assert.equal(quote.ok, true);
assert.equal(calculatePrice(quote.value).setupTotal > 0, true);
assert.equal(calculatePrice(quote.value).setupTotal, 1147);

const roi = calculateRoi({ averageSpend: 65, monthlyCustomers: 200, currentWebsite: "none" });
assert.equal(roi.estimatedMonthlyLoss > 0, true);

console.log("Validation tests passed.");
