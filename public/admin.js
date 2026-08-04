const money = cents => `$${(Number(cents) / 100).toFixed(2).replace(".00", "")}`;
const ordersWrap = document.getElementById("orders");
const template = document.getElementById("orderTemplate");
let orders = [];
const selectedIds = new Set();
let autoRefreshTimer = null;

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

function getFilteredOrders() {
  const statusValue = document.getElementById("statusFilter").value;
  const searchValue = document.getElementById("searchInput").value.trim().toLowerCase();
  const sortValue = document.getElementById("sortOrder").value;

  let filtered = statusValue ? orders.filter(order => order.status === statusValue) : orders.slice();

  if (searchValue) {
    filtered = filtered.filter(order =>
      order.customer_name.toLowerCase().includes(searchValue) ||
      order.customer_phone.toLowerCase().includes(searchValue) ||
      order.order_number.toLowerCase().includes(searchValue)
    );
  }

  const sorters = {
    new: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    old: (a, b) => new Date(a.created_at) - new Date(b.created_at),
    "total-desc": (a, b) => b.subtotal_cents - a.subtotal_cents,
    "total-asc": (a, b) => a.subtotal_cents - b.subtotal_cents
  };
  filtered.sort(sorters[sortValue] || sorters.new);

  return filtered;
}

function renderSummary(filtered) {
  const totalCents = filtered.reduce((sum, order) => sum + order.subtotal_cents, 0);
  const totalBottles = filtered.reduce((sum, order) => sum + order.bottle_count, 0);

  document.getElementById("summary").textContent =
    `${filtered.length} order${filtered.length === 1 ? "" : "s"} • ${money(totalCents)} • ${totalBottles} bottle${totalBottles === 1 ? "" : "s"}`;
}

function updateBulkBar() {
  const bar = document.getElementById("bulkBar");
  bar.hidden = selectedIds.size === 0;
  document.getElementById("bulkCount").textContent = `${selectedIds.size} selected`;
}

function renderOrders() {
  const filtered = getFilteredOrders();
  renderSummary(filtered);

  const visibleIds = new Set(filtered.map(order => order.id));
  for (const id of [...selectedIds]) {
    if (!visibleIds.has(id)) selectedIds.delete(id);
  }
  updateBulkBar();

  const selectAll = document.getElementById("selectAll");

  if (!filtered.length) {
    ordersWrap.innerHTML = '<div class="empty">No orders match this filter.</div>';
    selectAll.checked = false;
    return;
  }

  selectAll.checked = filtered.every(order => selectedIds.has(order.id));
  ordersWrap.innerHTML = "";

  filtered.forEach(order => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".order-card");
    card.dataset.status = order.status;
    card.dataset.id = order.id;

    const checkbox = fragment.querySelector(".order-checkbox");
    checkbox.checked = selectedIds.has(order.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedIds.add(order.id);
      else selectedIds.delete(order.id);
      updateBulkBar();
      selectAll.checked = filtered.every(item => selectedIds.has(item.id));
    });

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

    const paymentBadge = fragment.querySelector(".payment-badge");
    if (order.square_payment_link) {
      paymentBadge.textContent = "Prepay link sent ↗";
      paymentBadge.href = order.square_payment_link;
      paymentBadge.classList.add("paid");
    } else {
      paymentBadge.textContent = "Pay at pickup";
      paymentBadge.removeAttribute("href");
      paymentBadge.classList.add("pending");
    }

    const statusSelect = fragment.querySelector(".status-select");
    statusSelect.value = order.status;
    statusSelect.dataset.status = order.status;
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
        renderOrders();
      } catch (error) {
        order.status = previous;
        statusSelect.value = previous;
        statusSelect.dataset.status = previous;
        statusSelect.disabled = false;
        alert(error.message);
      }
    });

    const digits = order.customer_phone.replace(/\D/g, "");
    fragment.querySelector(".call-link").href = `tel:${digits}`;
    fragment.querySelector(".text-link").href =
      `sms:${digits}?body=${encodeURIComponent(`Hi ${order.customer_name}, this is Rally Point Refreshments regarding order ${order.order_number}.`)}`;

    ordersWrap.appendChild(fragment);
  });
}

document.getElementById("selectAll").addEventListener("change", event => {
  const filtered = getFilteredOrders();
  filtered.forEach(order => {
    if (event.target.checked) selectedIds.add(order.id);
    else selectedIds.delete(order.id);
  });
  renderOrders();
});

document.getElementById("bulkClear").addEventListener("click", () => {
  selectedIds.clear();
  renderOrders();
});

document.getElementById("bulkApply").addEventListener("click", async () => {
  const status = document.getElementById("bulkStatus").value;
  if (!status || !selectedIds.size) return;

  const applyButton = document.getElementById("bulkApply");
  applyButton.disabled = true;

  const ids = [...selectedIds];
  const results = await Promise.allSettled(ids.map(async id => {
    const response = await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({status})
    });
    if (!response.ok) throw new Error("failed");
    const order = orders.find(item => item.id === id);
    if (order) order.status = status;
  }));

  const failed = results.filter(result => result.status === "rejected").length;
  selectedIds.clear();
  document.getElementById("bulkStatus").value = "";
  applyButton.disabled = false;
  renderStats();
  renderOrders();

  if (failed) alert(`${failed} order${failed === 1 ? "" : "s"} could not be updated.`);
});

async function loadOrders(showLoading = true) {
  if (showLoading) ordersWrap.innerHTML = '<div class="loading">Loading orders…</div>';

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
    if (showLoading) ordersWrap.innerHTML = `<div class="empty">${error.message}</div>`;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    if (!document.hidden && selectedIds.size === 0) loadOrders(false);
  }, 30_000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

document.getElementById("autoRefresh").addEventListener("change", event => {
  if (event.target.checked) startAutoRefresh();
  else stopAutoRefresh();
});

document.getElementById("refresh").addEventListener("click", () => loadOrders());
document.getElementById("statusFilter").addEventListener("change", renderOrders);
document.getElementById("searchInput").addEventListener("input", renderOrders);
document.getElementById("sortOrder").addEventListener("change", renderOrders);

loadOrders();
if (document.getElementById("autoRefresh").checked) startAutoRefresh();
