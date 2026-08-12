const money = cents => `$${(Number(cents) / 100).toFixed(2).replace(".00", "")}`;
const FLAVOR_ORDER = [
  "Brown Sugar Cinnamon Latte",
  "Gourmet Sea Salt Caramel Latte",
  "Midnight Mocha Latte",
  "Double Vanilla Bean Oatmilk Latte",
  "Copycat Blondie Latte",
  "Sweet & Salty Hazelnut Latte",
  "White Chocolate Mocha Latte"
];
const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const ordersWrap = document.getElementById("orders");
const template = document.getElementById("orderTemplate");
let orders = [];
// Phone digits suppressed from the Coffee Club reminder list.
const optedOut = new Set();
const selectedIds = new Set();
let autoRefreshTimer = null;
let selectedPickupDate = "";

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
const parsePickupDate = value => new Date(`${value}T12:00:00`);

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPickupDay(value) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(parsePickupDate(value));
}

function getWeekOrders() {
  return selectedPickupDate === "all"
    ? [...orders]
    : orders.filter(order => order.pickup_date === selectedPickupDate);
}

function formatCreated(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPickup(value, windowName) {
  const date = parsePickupDate(value);
  const formatted = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
  return windowName === "Details confirmed by text"
    ? `${formatted} • 10 AM in Henderson`
    : `${formatted} • ${windowName}`;
}

function renderWeekOptions() {
  const select = document.getElementById("weekFilter");
  const dates = [...new Set(orders.map(order => order.pickup_date).filter(Boolean))];
  const today = localDateKey();
  const upcoming = dates.filter(value => value >= today).sort();
  const past = dates.filter(value => value < today).sort().reverse();
  const orderedDates = [...upcoming, ...past];

  if (!selectedPickupDate || (selectedPickupDate !== "all" && !dates.includes(selectedPickupDate))) {
    selectedPickupDate = upcoming[0] || past[0] || "all";
  }

  const nextPickup = upcoming[0];
  const options = orderedDates.map(value => {
    let context = "Past pickup";
    if (value === today) context = "Pickup today";
    else if (value === nextPickup) context = "Next pickup";
    else if (value >= today) context = "Upcoming";
    return `<option value="${escapeHtml(value)}">${escapeHtml(formatPickupDay(value))} · ${context}</option>`;
  });
  options.push('<option value="all">All pickup dates</option>');
  select.innerHTML = options.join("");
  select.value = selectedPickupDate;

  const weekOrders = getWeekOrders();
  document.getElementById("weekDescription").textContent = selectedPickupDate === "all"
    ? `Showing all ${weekOrders.length} stored orders.`
    : `${formatPickupDay(selectedPickupDate)} · ${weekOrders.length} order${weekOrders.length === 1 ? "" : "s"}`;
}

function getProductionSummary() {
  const productionOrders = getWeekOrders().filter(order =>
    order.payment_status === "COMPLETED" && order.status !== "cancelled"
  );
  const flavors = new Map();
  let sixPacks = 0;
  let threePacks = 0;
  let singles = 0;
  let addOns = 0;

  const addFlavor = (name, count = 1) => {
    if (!name || !Number.isFinite(count) || count < 1) return;
    flavors.set(name, (flavors.get(name) || 0) + count);
  };

  productionOrders.forEach(order => {
    (order.items || []).forEach(item => {
      if (item.type === "pack") {
        if (Number(item.size) === 6) sixPacks += 1;
        if (Number(item.size) === 3) threePacks += 1;
        (item.flavors || []).forEach(name => addFlavor(name));
        return;
      }

      if (item.type === "single") {
        const qty = Number(item.qty) || 0;
        singles += qty;
        if (item.bonus) addOns += qty;
        addFlavor(item.name, qty);
      }
    });
  });

  const totalBottles = [...flavors.values()].reduce((sum, count) => sum + count, 0);
  return {productionOrders, flavors, sixPacks, threePacks, singles, addOns, totalBottles};
}

function renderProduction() {
  const summary = getProductionSummary();
  const weekLabel = selectedPickupDate === "all" ? "All pickup dates" : formatPickupDay(selectedPickupDate);
  document.getElementById("productionMeta").textContent =
    `${weekLabel} · ${summary.productionOrders.length} paid, non-cancelled order${summary.productionOrders.length === 1 ? "" : "s"}`;

  const totalCards = [
    [summary.totalBottles, "Total bottles"],
    [summary.sixPacks, "6-packs"],
    [summary.threePacks, "3-packs"],
    [summary.singles, summary.addOns ? `Singles · ${summary.addOns} add-on` : "Singles"]
  ];
  document.getElementById("productionTotals").innerHTML = totalCards.map(([value, label]) => `
    <div class="production-total"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>
  `).join("");

  const known = FLAVOR_ORDER.filter(name => summary.flavors.has(name));
  const extra = [...summary.flavors.keys()].filter(name => !FLAVOR_ORDER.includes(name)).sort();
  const flavorNames = [...known, ...extra];
  document.getElementById("productionFlavors").innerHTML = flavorNames.length
    ? flavorNames.map(name => `
        <div class="production-flavor">
          <span>${escapeHtml(name)}</span>
          <strong>${summary.flavors.get(name)} <small>${summary.flavors.get(name) === 1 ? "bottle" : "bottles"}</small></strong>
        </div>
      `).join("")
    : '<span class="panel-empty">No paid bottles to prepare for this pickup date.</span>';
}

function getAttentionIssues(order) {
  const issues = [];
  const paymentStatus = String(order.payment_status || "UNPAID").toUpperCase();
  const active = !isDone(order);

  if (order.status === "cancelled" && paymentStatus === "COMPLETED") {
    issues.push({label: "Confirm Square refund", type: "urgent"});
  } else if (active && paymentStatus === "FAILED") {
    issues.push({label: "Payment failed", type: "urgent"});
  } else if (active && paymentStatus === "PROCESSING") {
    issues.push({label: "Payment processing", type: "urgent"});
  } else if (active && paymentStatus !== "COMPLETED") {
    issues.push({label: "Awaiting payment", type: "urgent"});
  }

  if (active && Boolean(order.delivery_interest)) {
    issues.push({label: "Delivery follow-up", type: "delivery"});
  }
  if (active && String(order.notes || "").trim()) {
    issues.push({label: "Customer note", type: "note"});
  }
  return issues;
}

function renderAttention() {
  const attentionOrders = getWeekOrders()
    .map(order => ({order, issues: getAttentionIssues(order)}))
    .filter(item => item.issues.length)
    .sort((a, b) => {
      const urgentA = a.issues.some(issue => issue.type === "urgent") ? 1 : 0;
      const urgentB = b.issues.some(issue => issue.type === "urgent") ? 1 : 0;
      return urgentB - urgentA || new Date(b.order.created_at) - new Date(a.order.created_at);
    });

  const count = document.getElementById("attentionCount");
  count.textContent = String(attentionOrders.length);
  count.classList.toggle("has-alerts", attentionOrders.length > 0);

  document.getElementById("attentionList").innerHTML = attentionOrders.length
    ? attentionOrders.map(({order, issues}) => `
        <button class="attention-order" type="button" data-order-id="${order.id}">
          <span>
            <strong>${escapeHtml(order.order_number)} · ${escapeHtml(order.customer_name)}</strong>
            <small>${escapeHtml(formatPickup(order.pickup_date, order.pickup_window))}</small>
            <span class="attention-badges">
              ${issues.map(issue => `<span class="attention-badge ${issue.type}">${escapeHtml(issue.label)}</span>`).join("")}
            </span>
          </span>
          <span>View order →</span>
        </button>
      `).join("")
    : '<span class="panel-empty">Nothing needs attention for this pickup date.</span>';
}

function renderOperations() {
  renderProduction();
  renderAttention();
}

function renderReminders() {
  const membersByPhone = new Map();
  orders
    .filter(order => Boolean(order.coffee_club_opt_in) && order.payment_status === "COMPLETED")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach(order => {
      const digits = order.customer_phone.replace(/\D/g, "");
      // Anyone who opted out stays off the list even if they order again.
      if (digits && !optedOut.has(digits) && !membersByPhone.has(digits)) {
        membersByPhone.set(digits, order);
      }
    });

  const members = [...membersByPhone.entries()];
  const removedNote = optedOut.size ? ` · ${optedOut.size} opted out` : "";
  document.getElementById("reminderCount").textContent = `${members.length} opted in${removedNote}`;

  const list = document.getElementById("reminderList");
  if (!members.length) {
    list.innerHTML = '<span class="reminder-empty">No Coffee Club members yet.</span>';
  } else {
    list.innerHTML = members.map(([digits, member]) => {
      const firstName = member.customer_name.trim().split(/\s+/)[0] || "there";
      const message = `Hi ${firstName}! Saturday Coffee Club ordering is open. Reorder your usual or build this week’s pack at https://rallypointrefreshments.com — Rally Point Refreshments. Reply STOP or use https://rallypointrefreshments.com/unsubscribe to stop these.`;
      return `
        <div class="reminder-member">
          <span><strong>${escapeHtml(member.customer_name)}</strong><small>${escapeHtml(member.customer_phone)}</small></span>
          <a href="sms:${digits}?body=${encodeURIComponent(message)}">Open reminder text</a>
          <button class="reminder-remove" type="button" data-remove-phone="${digits}"
                  data-remove-name="${escapeHtml(member.customer_name)}">Remove</button>
        </div>
      `;
    }).join("");
  }

  renderOptedOut();
}

function renderOptedOut() {
  const wrap = document.getElementById("optedOutList");
  if (!wrap) return;

  if (!optedOut.size) {
    wrap.innerHTML = '<span class="reminder-empty">Nobody has opted out.</span>';
    return;
  }

  wrap.innerHTML = [...optedOut].map(digits => {
    const match = orders.find(order => order.customer_phone.replace(/\D/g, "") === digits);
    const label = match ? match.customer_name : digits;
    return `
      <div class="reminder-member opted-out">
        <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(formatPhone(digits))}</small></span>
        <button class="reminder-restore" type="button" data-restore-phone="${digits}">Put back</button>
      </div>
    `;
  }).join("");
}

function formatPhone(digits) {
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10
    ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
    : digits;
}

async function coffeeClubRequest(path, method, phone) {
  const response = await fetch(path, {
    method,
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({phone})
  });
  if (!response.ok) throw new Error("That change could not be saved.");
}

document.addEventListener("click", async event => {
  const removeButton = event.target.closest("[data-remove-phone]");
  if (removeButton) {
    const {removePhone, removeName} = removeButton.dataset;
    if (!confirm(`Remove ${removeName} from the Coffee Club reminder list?`)) return;

    removeButton.disabled = true;
    try {
      await coffeeClubRequest("/api/coffee-club/remove", "POST", removePhone);
      optedOut.add(removePhone);
      renderReminders();
    } catch (error) {
      removeButton.disabled = false;
      alert(error.message);
    }
    return;
  }

  const restoreButton = event.target.closest("[data-restore-phone]");
  if (restoreButton) {
    const phone = restoreButton.dataset.restorePhone;
    restoreButton.disabled = true;
    try {
      await coffeeClubRequest("/api/coffee-club/optout", "DELETE", phone);
      optedOut.delete(phone);
      renderReminders();
    } catch (error) {
      restoreButton.disabled = false;
      alert(error.message);
    }
  }
});

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
  const weekOrders = getWeekOrders();

  document.getElementById("stats").innerHTML = statuses.map(([key, label]) => `
    <div class="stat">
      <strong>${weekOrders.filter(order => order.status === key).length}</strong>
      <span>${label}</span>
    </div>
  `).join("");

  document.getElementById("countActive").textContent = weekOrders.filter(o => !isDone(o)).length;
  document.getElementById("countDone").textContent = weekOrders.filter(isDone).length;
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

  let filtered = getWeekOrders().filter(inActiveTab);
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
  renderOperations();
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
    renderOperations();
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

function focusOrder(id) {
  const order = orders.find(item => String(item.id) === String(id));
  if (!order) return;

  activeTab = isDone(order) ? "done" : "active";
  selectedIds.clear();
  document.querySelectorAll(".tab").forEach(button => {
    const on = button.dataset.tab === activeTab;
    button.classList.toggle("active", on);
    button.setAttribute("aria-selected", String(on));
  });
  renderStatusFilter("");
  document.getElementById("searchInput").value = "";
  renderStats();
  renderOrders();

  requestAnimationFrame(() => {
    const card = document.querySelector(`.order-card[data-id="${CSS.escape(String(id))}"]`);
    if (!card) return;
    card.scrollIntoView({behavior: "smooth", block: "center"});
    card.classList.add("is-focused");
    window.setTimeout(() => card.classList.remove("is-focused"), 1700);
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
  renderOperations();
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
    optedOut.clear();
    (data.coffeeClubOptOuts || []).forEach(digits => optedOut.add(digits));
    renderWeekOptions();
    renderStats();
    renderReminders();
    renderOperations();
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
document.getElementById("weekFilter").addEventListener("change", event => {
  selectedPickupDate = event.target.value;
  selectedIds.clear();
  renderWeekOptions();
  renderStats();
  renderOperations();
  renderOrders();
});
document.getElementById("attentionList").addEventListener("click", event => {
  const button = event.target.closest("[data-order-id]");
  if (button) focusOrder(button.dataset.orderId);
});
document.getElementById("printProduction").addEventListener("click", () => window.print());
document.getElementById("statusFilter").addEventListener("change", renderOrders);
document.getElementById("searchInput").addEventListener("input", renderOrders);
document.getElementById("sortOrder").addEventListener("change", renderOrders);

renderStatusFilter("");
loadOrders();
if (document.getElementById("autoRefresh").checked) startAutoRefresh();
