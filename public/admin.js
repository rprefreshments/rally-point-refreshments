const money = cents => `$${(Number(cents) / 100).toFixed(2).replace(".00", "")}`;
const ordersWrap = document.getElementById("orders");
const template = document.getElementById("orderTemplate");
let orders = [];

function formatCreated(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPickup(value, windowName) {
  const date = new Date(`${value}T12:00:00`);
  const formatted = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
  return windowName === "Details confirmed by text"
    ? `${formatted} • Details by text`
    : `${formatted} • ${windowName}`;
}

function summarizeItems(items) {
  return items.map(item => {
    if (item.type === "single") return `${item.qty}× ${item.name}`;
    const counts = item.flavors.reduce((result, flavor) => {
      result[flavor] = (result[flavor] || 0) + 1;
      return result;
    }, {});
    const flavors = Object.entries(counts).map(([name, count]) => `${count}× ${name}`).join("<br>");
    return `<strong>${item.size}-Pack</strong><br>${flavors}`;
  }).join("<hr>");
}

function renderStats() {
  const statuses = [
    ["new", "New"],
    ["confirmed", "Confirmed"],
    ["preparing", "Preparing"],
    ["ready", "Ready"],
    ["picked_up", "Picked up"]
  ];

  document.getElementById("stats").innerHTML = statuses.map(([key, label]) => `
    <div class="stat">
      <strong>${orders.filter(order => order.status === key).length}</strong>
      <span>${label}</span>
    </div>
  `).join("");
}

function renderOrders() {
  const filter = document.getElementById("statusFilter").value;
  const filtered = filter ? orders.filter(order => order.status === filter) : orders;

  if (!filtered.length) {
    ordersWrap.innerHTML = '<div class="empty">No orders match this filter.</div>';
    return;
  }

  ordersWrap.innerHTML = "";

  filtered.forEach(order => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".order-card");
    fragment.querySelector(".order-number").textContent = order.order_number;
    fragment.querySelector(".created-at").textContent = formatCreated(order.created_at);
    fragment.querySelector(".customer-name").textContent = order.customer_name;

    const phone = fragment.querySelector(".customer-phone");
    phone.textContent = order.customer_phone;
    phone.href = `tel:${order.customer_phone.replace(/\D/g, "")}`;

    fragment.querySelector(".pickup").textContent = formatPickup(order.pickup_date, order.pickup_window);
    fragment.querySelector(".total").textContent = money(order.subtotal_cents);
    fragment.querySelector(".items").innerHTML = summarizeItems(order.items);
    fragment.querySelector(".notes").textContent = order.notes || "No notes";

    const statusSelect = fragment.querySelector(".status-select");
    statusSelect.value = order.status;
    statusSelect.addEventListener("change", async () => {
      const previous = order.status;
      order.status = statusSelect.value;
      statusSelect.disabled = true;

      try {
        const response = await fetch(`/api/orders/${order.id}`, {
          method: "PATCH",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({status: statusSelect.value})
        });
        if (!response.ok) throw new Error("Could not update order");
        renderStats();
      } catch (error) {
        order.status = previous;
        statusSelect.value = previous;
        alert(error.message);
      } finally {
        statusSelect.disabled = false;
      }
    });

    const digits = order.customer_phone.replace(/\D/g, "");
    fragment.querySelector(".call-link").href = `tel:${digits}`;
    fragment.querySelector(".text-link").href =
      `sms:${digits}&body=${encodeURIComponent(`Hi ${order.customer_name}, this is Rally Point Refreshments regarding order ${order.order_number}.`)}`;

    card.dataset.id = order.id;
    ordersWrap.appendChild(fragment);
  });
}

async function loadOrders() {
  ordersWrap.innerHTML = '<div class="loading">Loading orders…</div>';

  try {
    const response = await fetch("/api/orders", {cache: "no-store"});
    if (!response.ok) throw new Error("Could not load orders");
    const data = await response.json();
    orders = data.orders || [];
    renderStats();
    renderOrders();
    document.getElementById("lastUpdated").textContent =
      `Updated ${new Intl.DateTimeFormat("en-US", {hour: "numeric", minute: "2-digit"}).format(new Date())}`;
  } catch (error) {
    ordersWrap.innerHTML = `<div class="empty">${error.message}</div>`;
  }
}

document.getElementById("refresh").addEventListener("click", loadOrders);
document.getElementById("statusFilter").addEventListener("change", renderOrders);
loadOrders();
