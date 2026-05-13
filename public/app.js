const cur = document.getElementById("cur");
const ring = document.getElementById("curR");
let mx = 0;
let my = 0;
let rx = 0;
let ry = 0;

if (cur && ring && !window.matchMedia("(pointer: coarse)").matches) {
  document.addEventListener("mousemove", (event) => {
    mx = event.clientX;
    my = event.clientY;
    cur.style.left = `${mx}px`;
    cur.style.top = `${my}px`;
  });

  (function animateCursor() {
    rx += (mx - rx) * 0.1;
    ry += (my - ry) * 0.1;
    ring.style.left = `${rx}px`;
    ring.style.top = `${ry}px`;
    requestAnimationFrame(animateCursor);
  })();
}

const answers = { q1: null, q2: null, q3: [], q4: null, q5: null };
let latestEstimate = null;

function pick(q, btn, val) {
  document.querySelectorAll(`#${q} .opt`).forEach((button) => button.classList.remove("selected"));
  btn.classList.add("selected");
  answers[q] = val;
  checkReady();
}

function toggle(q, btn, val) {
  btn.classList.toggle("selected");
  if (btn.classList.contains("selected")) {
    if (!answers.q3.includes(val)) answers.q3.push(val);
  } else {
    answers.q3 = answers.q3.filter((item) => item !== val);
  }
  checkReady();
}

function checkReady() {
  const websiteSelected = answers.q3.includes("website");
  const pageOk = !websiteSelected || answers.q4 !== null;
  const ready = answers.q1 && answers.q2 && answers.q3.length > 0 && pageOk && answers.q5;
  const button = document.getElementById("calcBtn");
  if (button) button.disabled = !ready;
}

function clientEstimate() {
  const items = [];
  let total = 0;

  if (answers.q3.includes("website") && answers.q4 !== "na") {
    const amount = { 3: 399, 5: 599, 10: 899 }[answers.q4] || 599;
    const pages = answers.q4 === "3" ? "1-3 pages" : answers.q4 === "5" ? "4-6 pages" : "7-10 pages";
    total += amount;
    items.push({ label: `Website - ${pages}`, value: `$${amount.toLocaleString()}` });
  }

  if (answers.q3.includes("google")) {
    const amount = answers.q2 === "nothing" || answers.q2 === "facebook" ? 249 : 149;
    total += amount;
    items.push({ label: "Google Business Setup & Optimization", value: `$${amount}` });
  }

  if (answers.q3.includes("booking")) {
    const amount = ["restaurant", "medical", "fitness"].includes(answers.q1) ? 299 : 199;
    total += amount;
    items.push({ label: "Online Booking Integration", value: `$${amount}` });
  }

  if (answers.q3.includes("reviews")) {
    total += 149;
    items.push({ label: "Review Management Setup", value: "$149" });
  }

  if (answers.q3.includes("maintenance")) {
    items.push({ label: "Monthly Maintenance", value: "See retainer below", included: true });
  }

  return { total, items };
}

function calcPrice() {
  if (answers.q3.includes("website") && !answers.q4) {
    alert("Please select how many pages you need.");
    return;
  }

  const estimate = clientEstimate();
  if (estimate.total === 0 && !answers.q3.includes("maintenance")) {
    alert("Please select at least one service.");
    return;
  }

  const retainers = {
    none: "One-time project only - no monthly commitment.",
    basic: "+ $150/mo - updates, monitoring & monthly report.",
    standard: "+ $300/mo - updates, review management & monthly report.",
    full: "+ $600/mo - full management: updates, reviews, reporting & priority support.",
  };

  latestEstimate = estimate;
  document.getElementById("calcPh").style.display = "none";
  document.getElementById("calcResult").classList.add("on");
  document.getElementById("rPrice").textContent = estimate.total.toLocaleString();
  document.getElementById("rRetainer").innerHTML = `<span style="color:var(--muted);font-size:13px;">${retainers[answers.q5] || retainers.none}</span>`;
  document.getElementById("rBreakdown").innerHTML = estimate.items
    .map((item) => `<div class="rb-row"><span class="rb-label">${item.label}</span><span class="rb-val${item.included ? " inc" : ""}">${item.value}</span></div>`)
    .join("");
}

function setStatus(form, message, type = "") {
  const status = form.querySelector("[data-status]");
  if (!status) return;
  status.textContent = message || "";
  status.className = `form-status ${type}`.trim();
}

function setLoading(form, loading) {
  const button = form.querySelector("button[type='submit']");
  if (!button) return;
  button.disabled = loading;
  button.dataset.originalText ||= button.textContent;
  button.textContent = loading ? "Saving..." : button.dataset.originalText;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.errors ? body.errors.join(" ") : body.error || "Request failed.");
  }
  return body;
}

function attachSubmit(formId, handler) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(form, "");
    setLoading(form, true);
    try {
      await handler(form, Object.fromEntries(new FormData(form).entries()));
    } catch (error) {
      setStatus(form, error.message, "error");
    } finally {
      setLoading(form, false);
    }
  });
}

attachSubmit("quoteLeadForm", async (form, data) => {
  if (!latestEstimate) calcPrice();
  const payload = {
    website: data.website,
    name: data.name,
    email: data.email,
    phone: data.phone,
    businessName: data.businessName,
    businessType: answers.q1,
    currentPresence: answers.q2,
    needs: answers.q3,
    pageCount: answers.q4 || "na",
    maintenance: answers.q5 || "none",
  };
  const response = await postJson("/api/quote-requests", payload);
  const serverTotal = response.estimate?.setupTotal;
  if (Number.isFinite(serverTotal)) {
    setStatus(form, `Estimate saved. Backend quote reference: $${serverTotal.toLocaleString()} setup.`, "success");
  } else {
    setStatus(form, "Estimate saved. We will follow up to confirm the exact scope.", "success");
  }
});

attachSubmit("contactForm", async (form, data) => {
  const response = await postJson("/api/contact-requests", {
    website: data.website,
    name: data.name,
    email: data.email,
    phone: data.phone,
    businessName: "",
    message: data.message,
  });
  form.reset();
  setStatus(form, response.message || "Thanks. We received your request.", "success");
});

window.pick = pick;
window.toggle = toggle;
window.calcPrice = calcPrice;
