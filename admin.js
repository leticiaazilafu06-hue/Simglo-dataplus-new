const tokenInput = document.getElementById("admin-token");
const statusBox = document.getElementById("sms-status");
const logsBox = document.getElementById("sms-logs");
const statsNote = document.getElementById("stats-note");

function getToken() { return tokenInput.value.trim(); }
function authHeaders() { return { "Content-Type": "application/json", "Authorization": `Bearer ${getToken()}` }; }
function showStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error-text", isError);
}

const savedToken = sessionStorage.getItem("simglo_admin_token");
if (savedToken) tokenInput.value = savedToken;
document.getElementById("save-token").addEventListener("click", () => {
  sessionStorage.setItem("simglo_admin_token", getToken());
  showStatus("Admin token saved for this browser session.");
  loadStats();
  loadLogs();
});

document.getElementById("invite-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!getToken()) return showStatus("Enter your admin token first.", true);
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  showStatus("Submitting invitation…");
  try {
    const response = await fetch("/api/admin/sms/agent-invitation", {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ phone: document.getElementById("phone").value, consent: document.getElementById("consent").checked })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not send invitation.");
    showStatus(result.message || "Invitation submitted.");
    event.currentTarget.reset();
    await Promise.all([loadLogs(), loadStats()]);
  } catch (error) { showStatus(error.message, true); }
  finally { button.disabled = false; }
});

async function loadStats() {
  if (!getToken()) {
    statsNote.textContent = "Enter your admin token first to view SMS usage.";
    return;
  }
  statsNote.textContent = "Loading SMS usage…";
  try {
    const response = await fetch("/api/admin/sms/stats", { headers: authHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load SMS usage.");
    document.getElementById("stat-total").textContent = Number(result.total_invitations || 0).toLocaleString();
    document.getElementById("stat-month").textContent = Number(result.month_submitted || 0).toLocaleString();
    document.getElementById("stat-failed").textContent = Number(result.total_failed || 0).toLocaleString();
    document.getElementById("stat-spend").textContent = `GH₵${Number(result.estimated_spend_ghs || 0).toFixed(2)}`;
    const rate = Number(result.estimated_rate_per_sms_ghs || 0);
    const recorded = Number(result.recorded_spend_ghs || 0);
    statsNote.textContent = `Estimated spend: GH₵${Number(result.estimated_spend_ghs || 0).toFixed(2)}. Hubtel-reported recorded spend: GH₵${recorded.toFixed(2)}. For successful messages without billing details, the estimate uses GH₵${rate.toFixed(4)} per SMS. This is not your live Hubtel wallet balance.`;
  } catch (error) {
    statsNote.textContent = error.message;
  }
}

document.getElementById("refresh-stats").addEventListener("click", loadStats);

async function loadLogs() {
  if (!getToken()) return showStatus("Enter your admin token first.", true);
  logsBox.textContent = "Loading invitation history…";
  try {
    const response = await fetch("/api/admin/sms/logs", { headers: authHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load history.");
    logsBox.replaceChildren();
    if (!result.messages.length) { logsBox.textContent = "No invitations have been sent yet."; return; }
    result.messages.forEach(item => {
      const row = document.createElement("div");
      row.className = "log-row";
      const details = document.createElement("span");
      details.textContent = `${item.phone_number} · ${new Date(item.created_at).toLocaleString()}`;
      const state = document.createElement("strong");
      state.textContent = item.status;
      state.className = item.status === "submitted" ? "success-text" : "error-text";
      row.append(details, state);
      if (item.error_message) {
        const error = document.createElement("small");
        error.textContent = item.error_message;
        row.append(error);
      }
      logsBox.append(row);
    });
  } catch (error) { logsBox.textContent = error.message; }
}
document.getElementById("refresh-logs").addEventListener("click", async () => {
  try { await Promise.all([loadLogs(), loadStats()]); }
  catch (error) { showStatus(error.message, true); }
});

if (savedToken) {
  Promise.all([loadLogs(), loadStats()]).catch(error => showStatus(error.message, true));
}


// Whole-business reports count only paid and successfully delivered orders.
function reportMoney(value) {
  return `GH₵${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
async function loadSalesReports() {
  const note = document.getElementById("sales-note");
  if (!getToken()) { note.textContent = "Enter your admin token first to view business sales reports."; return; }
  note.textContent = "Loading business sales reports…";
  try {
    const response = await fetch("/api/admin/sales/reports", { headers: authHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load sales reports.");
    for (const period of ["week", "month", "year"]) {
      const row = result[period] || {};
      document.getElementById(`sales-${period}`).textContent = reportMoney(row.sales_ghs);
      document.getElementById(`profit-${period}`).textContent = row.profit_ghs === null ? "Unavailable" : reportMoney(row.profit_ghs);
      document.getElementById(`orders-${period}`).textContent = `Orders: ${Number(row.orders || 0).toLocaleString()}`;
    }
    note.textContent = `Updated ${new Date(result.generated_at).toLocaleString()}. Profit is sales less recorded supplier cost. If supplier costs are missing, profit is marked unavailable rather than overstated.`;
  } catch (error) { note.textContent = error.message; }
}
document.getElementById("refresh-sales")?.addEventListener("click", loadSalesReports);

const supplierStatus = document.getElementById("supplier-status");
const bundleList = document.getElementById("bundle-list");

function supplierMessage(message, isError = false) {
  supplierStatus.textContent = message;
  supplierStatus.classList.toggle("error-text", isError);
  supplierStatus.classList.toggle("success-text", !isError);
}

async function supplierRequest(url, options = {}) {
  if (!getToken()) throw new Error("Enter your admin token first.");

  const response = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

document.getElementById("test-supplier").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  supplierMessage("Testing NetPulse connection...");

  try {
    const result = await supplierRequest("/api/admin/supplier/test");
    supplierMessage(result.message);
  } catch (error) {
    supplierMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("fetch-bundles").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  supplierMessage("Fetching packages from NetPulse...");

  try {
    const result = await supplierRequest("/api/admin/supplier/fetch", {
      method: "POST",
      body: "{}"
    });

    supplierMessage(
      `${result.message} Added: ${result.added}; updated: ${result.updated}; skipped: ${result.skipped}.`
    );

    await loadBundleSettings();
  } catch (error) {
    supplierMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

function makeBundleRow(bundle) {
  const row = document.createElement("div");
  row.className = "log-row";

  const info = document.createElement("div");
  info.style.flex = "1 1 160px";

  const title = document.createElement("strong");
  title.textContent = `${bundle.network} · ${bundle.data_amount}`;

  const cost = document.createElement("p");
  cost.className = "muted";
  cost.textContent = `Supplier cost: GH₵${Number(bundle.supplier_price).toFixed(2)}`;

  info.append(title, cost);

  const price = document.createElement("input");
  price.type = "number";
  price.min = "0";
  price.step = "0.01";
  price.value = Number(bundle.selling_price || 0).toFixed(2);
  price.style.width = "115px";
  price.setAttribute("aria-label", "Your selling price");

  const activeLabel = document.createElement("label");
  const active = document.createElement("input");
  active.type = "checkbox";
  active.checked = bundle.active === true;
  activeLabel.append(active, document.createTextNode(" Active"));

  const save = document.createElement("button");
  save.type = "button";
  save.className = "outline-btn";
  save.textContent = "Save";

  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await supplierRequest(
        `/api/admin/bundles/${encodeURIComponent(bundle.id)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            selling_price: price.value,
            active: active.checked
          })
        }
      );
      supplierMessage(`Saved ${bundle.network} ${bundle.data_amount}.`);
    } catch (error) {
      supplierMessage(error.message, true);
    } finally {
      save.disabled = false;
    }
  });

  row.append(info, price, activeLabel, save);
  return row;
}

async function loadBundleSettings() {
  bundleList.textContent = "Loading bundles...";

  try {
    const result = await supplierRequest("/api/admin/bundles");
    bundleList.replaceChildren();

    if (!result.bundles.length) {
      bundleList.textContent = "No bundles yet. Use Fetch data bundles.";
      return;
    }

    result.bundles.forEach(bundle => {
      bundleList.append(makeBundleRow(bundle));
    });
  } catch (error) {
    bundleList.textContent = error.message;
  }
}

document.getElementById("refresh-bundles")
  .addEventListener("click", loadBundleSettings);

