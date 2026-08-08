const money = cents => `$${(Number(cents) / 100).toFixed(2).replace(".00", "")}`;
const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const ordersWrap = document.getElementById("orders");
const template = document.getElementById("orderTemplate");
let orders = [];
const selectedIds = new Set();
let autoRefreshTimer = null;

// An order is "done" once it is picked up or cancelled; those move to the
// Completed tab so the working list only shows what still needs attention.
const DONE_STATUSES = new Set(["picked_up", "cancelled"]);
// Where "Undo" sends an order back to, per status.
const UNDO_TARGET = {picked_up: "ready", cancelled: "new"};
const STATUS_OPTIONS = {
  active: [["", "All active"], ["new", "New"], ["confirmed", "Confirmed"],
           ["preparing", "Preparing"], ["ready", "Ready"]],
  done: [["", "All completed"], ["picked_up", "Picked up"], ["cancelled", "Cancelled"]]
};
let activeTab = "active";

const isDone = order => DONE_STATUSES.has(order.status);
const inActiveTab = order => (activeTab === "done" ? isDone(order) : !isDone(order));

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
    ? `${formatted} • 10 AM in Henderson`
    : `${formatted} • ${windowName}`;
}

function renderReminders() {
  const membersByPhone = new Map();
  orders
    .filter(order => Boolean(order.coffee_club_opt_in) && order.payment_status === "COMPLETED")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach(order => {
      const digits = order.customer_phone.replace(/\D/g, "");
      if (digits && !membersByPhone.has(digits)) membersByPhone.set(digits, order);
    });

  const members = [...membersByPhone.entries()];
  document.getElementById("reminderCount").textContent = `${members.length} opted in`;
  const list = document.getElementById("reminderList");
  if (!members.length) {
    list.innerHTML = '<span class="reminder-empty">No Coffee Club members yet.</span>';
    return;
  }

  list.innerHTML = members.map(([digits, member]) => {
    const firstName = member.customer_name.trim().split(/\s+/)[0] || "there";
    const message = `Hi ${firstName}! Saturday Coffee Club ordering is open. Reorder your usual or build this week’s pack at https://rallypointrefreshments.com — Rally Point Refreshments. Reply STOP to opt out.`;
    return `
      <div class="reminder-member">
        <span><strong>${escapeHtml(member.customer_name)}</strong><small>${escapeHtml(member.customer_phone)}</small></span>
        <a href="sms:${digits}?body=${encodeURIComponent(message)}">Open reminder text</a>
      </div>
    `;
  }).join("");
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
  // Only the statuses belonging to the visible tab, so the tiles stay useful.
  const statuses = STATUS_OPTIONS[activeTab].filter(([key]) => key);

  document.getElementById("stats").innerHTML = statuses.map(([key, label]) => `
    <div class="stat">
      <strong>${orders.filter(order => order.status === key).length}</strong>
      <span>${label}</span>
    </div>
  `).join("");

  document.getElementById("countActive").textContent = orders.filter(o => !isDone(o)).length;
  document.getElementById("countDone").textContent = orders.filter(isDone).length;
}

function renderStatusFilter(keepValue) {
  const select = document.getElementById("statusFilter");
  select.innerHTML = STATUS_OPTIONS[activeTab]
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  select.value = STATUS_OPTIONS[activeTab].some(([v]) => v === keepValue) ? keepValue : "";
}

function switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  selectedIds.clear();

  document.querySelectorAll(".tab").forEach(button => {
    const on = button.dataset.tab === tab;
    button.classList.toggle("active", on);
    button.setAttribute("aria-selected", String(on));
  });

  renderStatusFilter("");
  renderStats();
  renderOrders();
}

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

function getFilteredOrders() {
  const statusValue = document.getElementById("statusFilter").value;
  const searchValue = document.getElementById("searchInput").value.trim().toLowerCase();
  const sortValue = document.getElementById("sortOrder").value;

  let filtered = orders.filter(inActiveTab);
  if (statusValue) filtered = filtered.filter(order => order.status === statusValue);

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

async function setStatus(order, next) {
  const previous = order.status;
  if (next === previous) {
    renderOrders();
    return;
  }

  order.status = next;
  renderStats();
  renderOrders();

  try {
    const response = await fetch(`/api/orders/${order.id}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({status: next})
    });
    if (!response.ok) throw new Error("Could not update order");
  } catch (error) {
    order.status = previous;
    renderStats();
    renderOrders();
    alert(error.message);
  }
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
    card.dataset.done = isDone(order) ? "yes" : "no";

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
    if (order.payment_status === "COMPLETED") {
      paymentBadge.textContent = order.square_receipt_url ? "Paid online · receipt ↗" : "Paid online";
      if (order.square_receipt_url) paymentBadge.href = order.square_receipt_url;
      else paymentBadge.removeAttribute("href");
      paymentBadge.classList.add("paid");
    } else if (order.payment_status === "PROCESSING") {
      paymentBadge.textContent = "Payment processing";
      paymentBadge.removeAttribute("href");
      paymentBadge.classList.add("pending");
    } else if (order.payment_status === "FAILED") {
      paymentBadge.textContent = "Payment failed";
      paymentBadge.removeAttribute("href");
      paymentBadge.classList.add("failed");
    } else {
      paymentBadge.textContent = "Awaiting online payment";
      paymentBadge.removeAttribute("href");
      paymentBadge.classList.add("pending");
    }

    const preferenceBadges = fragment.querySelector(".preference-badges");
    preferenceBadges.innerHTML = [
      order.delivery_interest ? '<span class="preference delivery">Delivery interest — follow up</span>' : "",
      order.coffee_club_opt_in ? '<span class="preference club">Coffee Club opt-in</span>' : ""
    ].filter(Boolean).join("");
    preferenceBadges.hidden = !preferenceBadges.innerHTML;

    const statusSelect = fragment.querySelector(".status-select");
    statusSelect.value = order.status;
    statusSelect.dataset.status = order.status;
    statusSelect.addEventListener("change", () => {
      statusSelect.disabled = true;
      setStatus(order, statusSelect.value);
    });

    fragment.querySelector(".done-btn").addEventListener("click", () => {
      setStatus(order, "picked_up");
    });
    fragment.querySelector(".undo-btn").addEventListener("click", () => {
      setStatus(order, UNDO_TARGET[order.status] || "ready");
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
    renderReminders();
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

renderStatusFilter("");
loadOrders();
if (document.getElementById("autoRefresh").checked) startAutoRefresh();
