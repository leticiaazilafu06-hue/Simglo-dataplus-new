async function loadStore() {
  const status = document.getElementById("bundle-status");
  const list = document.getElementById("bundle-list");
  try {
    const response = await fetch("/api/store/bundles");
    if (!response.ok) throw new Error("Store data is not available yet.");
    const data = await response.json();
    if (!data.bundles || data.bundles.length === 0) {
      status.textContent = "No bundles have been published yet.";
      return;
    }
    list.innerHTML = "";
    data.bundles.forEach(bundle => {
      const card = document.createElement("article");
      card.className = "bundle-card";
      const title = document.createElement("h3");
      title.textContent = `${bundle.network} · ${bundle.name}`;
      const amount = document.createElement("p");
      amount.textContent = bundle.data_amount;
      const price = document.createElement("strong");
      price.textContent = `GH₵ ${Number(bundle.selling_price).toFixed(2)}`;
      card.append(title, amount, price);
      list.appendChild(card);
    });
    status.textContent = "Bundles loaded from the Simglo Dataplus server.";
  } catch (error) {
    status.textContent = "Store database setup is still required.";
  }
}

async function loadPublicSettings() {
  try {
    const response = await fetch("/api/admin/settings/public");
    if (!response.ok) return;
    const { settings } = await response.json();
    if (settings.customer_service_whatsapp) {
      const digits = settings.customer_service_whatsapp.replace(/\\D/g, "");
      document.getElementById("support-link").href = `https://wa.me/${digits}`;
    }
    if (settings.whatsapp_channel_url) {
      document.getElementById("channel-link").href = settings.whatsapp_channel_url;
    }
  } catch (_error) { /* Settings remain unavailable until database setup. */ }
}
loadStore();
loadPublicSettings();
