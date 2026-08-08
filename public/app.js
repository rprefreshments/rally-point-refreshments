const BUSINESS_PHONE = "12522260557";
const CART_KEY = "rallyCartV6";
const LAST_ORDER_KEY = "rallyLastOrderV1";
const FAVORITE_PACK_KEY = "rallyFavoriteSixPackV1";
const PENDING_CART_KEY = "rallyPendingOrderCartV1";
const PICKUP_WINDOW = "10 AM in Henderson";

const products = [
  {
    name: "Brown Sugar Cinnamon Latte",
    icon: "cinnamon",
    accent: "#9b4b24",
    soft: "#f4dfce",
    desc: "Brown sugar sweetness with a cozy cinnamon finish.",
    badge: "Best seller"
  },
  {
    name: "Gourmet Sea Salt Caramel Latte",
    icon: "caramel",
    accent: "#d16a13",
    soft: "#ffead3",
    desc: "Rich caramel balanced with just enough sea salt.",
    badge: "Best seller"
  },
  {
    name: "Midnight Mocha Latte",
    icon: "mocha",
    accent: "#6c3525",
    soft: "#ead8d1",
    desc: "Deep chocolate flavor for a bold, indulgent coffee.",
    badge: "Popular"
  },
  {
    name: "Double Vanilla Bean Oatmilk Latte",
    icon: "vanilla",
    accent: "#94712f",
    soft: "#f5e9c8",
    desc: "Silky oatmilk with a smooth double vanilla finish."
  },
  {
    name: "Copycat Blondie Latte",
    icon: "blondie",
    accent: "#bc820c",
    soft: "#fff0ba",
    desc: "Creamy vanilla-caramel flavor inspired by a coffee-shop favorite."
  },
  {
    name: "Sweet & Salty Hazelnut Latte",
    icon: "hazelnut",
    accent: "#7f3d21",
    soft: "#eddbcf",
    desc: "Toasty hazelnut with a balanced sweet-and-salty finish."
  },
  {
    name: "White Chocolate Mocha Latte",
    icon: "white-chocolate",
    accent: "#8f6d55",
    soft: "#f4e9e1",
    desc: "Sweet white chocolate blended into a smooth, creamy latte."
  }
];

function iconSvg(type) {
  const icons = {
    cinnamon: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 44 43 19c4-4 10 2 6 6L24 50c-4 4-10-2-6-6Z"/><path d="m22 39 7 7M29 32l7 7M36 25l7 7"/><path d="M16 19c7-6 18-3 20 5-8-4-15-2-20 5 1-4 1-7 0-10Z"/></svg>`,
    caramel: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 9c8 12 15 20 15 30a15 15 0 1 1-30 0c0-10 7-18 15-30Z"/><path d="M24 39c2 6 7 9 13 8"/><path d="M49 17h7M52.5 13.5v7M8 24h7M11.5 20.5v7"/></svg>`,
    mocha: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M15 21h34v22c0 7-6 12-13 12h-8c-7 0-13-5-13-12V21Z"/><path d="M49 27h4c6 0 6 13 0 13h-4"/><path d="M23 13c0 4 4 4 4 8M34 10c0 5 5 5 5 10"/><path d="M23 36c6-5 12-5 18 0-6 5-12 5-18 0Z"/></svg>`,
    vanilla: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M31 31c-8-2-13-8-11-14 7-1 13 4 14 12"/><path d="M33 31c2-8 8-13 14-11 1 7-4 13-12 14"/><path d="M32 34c8 2 13 8 11 14-7 1-13-4-14-12"/><path d="M30 33c-2 8-8 13-14 11-1-7 4-13 12-14"/><circle cx="32" cy="32" r="4"/></svg>`,
    blondie: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="m32 8 5.5 13.5L51 27l-13.5 5.5L32 46l-5.5-13.5L13 27l13.5-5.5L32 8Z"/><path d="m49 42 2.5 6.5L58 51l-6.5 2.5L49 60l-2.5-6.5L40 51l6.5-2.5L49 42Z"/></svg>`,
    hazelnut: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M20 24c7-8 17-8 24 0 6 7 5 19-3 27-5 5-13 5-18 0-8-8-9-20-3-27Z"/><path d="M20 24c2-8 8-13 16-13 2 7-1 13-8 17"/><path d="M24 29c5 3 11 3 16 0"/></svg>`,
    "white-chocolate": `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 17h38v34H13z"/><path d="M25.7 17v34M38.3 17v34M13 28.3h38M13 39.7h38"/></svg>`
  };
  return icons[type] || icons.mocha;
}

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const cart = readStoredArray(CART_KEY);
const money = value => `$${Number(value).toFixed(2).replace(".00", "")}`;
const ORDER_CUTOFF_DAY = 4;
const ORDER_CUTOFF_HOUR = 18;

function getOrderDeadline(forPickup) {
  const deadline = new Date(forPickup);
  deadline.setDate(forPickup.getDate() - 2);
  deadline.setHours(ORDER_CUTOFF_HOUR, 0, 0, 0);
  return deadline;
}

function getNextSaturday() {
  const now = new Date();
  const day = now.getDay();
  let add = (6 - day + 7) % 7;
  const pastCutoff = day > ORDER_CUTOFF_DAY || (day === ORDER_CUTOFF_DAY && now.getHours() >= ORDER_CUTOFF_HOUR);
  if (add === 0 || pastCutoff) add = add === 0 ? 7 : add + 7;
  const next = new Date(now);
  next.setDate(now.getDate() + add);
  next.setHours(12, 0, 0, 0);
  return next;
}

function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPickupDate(date) {
  return new Intl.DateTimeFormat("en-US", {weekday: "long", month: "short", day: "numeric"}).format(date);
}

const pickupDate = getNextSaturday();
const pickupIso = toLocalIsoDate(pickupDate);
const orderDeadline = getOrderDeadline(pickupDate);
document.getElementById("pickupBanner").textContent = `Fresh pickup ${formatPickupDate(pickupDate)}`;
document.getElementById("pickupDateText").textContent = `${formatPickupDate(pickupDate)} at 10 AM`;

function renderDeadlineCountdown() {
  const target = document.getElementById("orderDeadline");
  const msLeft = orderDeadline - new Date();
  if (msLeft <= 0) {
    target.textContent = "Ordering now open";
    return;
  }
  const hoursLeft = Math.floor(msLeft / 3_600_000);
  const daysLeft = Math.floor(hoursLeft / 24);
  if (daysLeft >= 2) target.textContent = `${daysLeft} days left to order`;
  else if (hoursLeft >= 24) target.textContent = "1 day left to order";
  else if (hoursLeft >= 1) target.textContent = `Only ${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"} left to order`;
  else target.textContent = "Last call — ordering closes soon";
}

renderDeadlineCountdown();
setInterval(renderDeadlineCountdown, 60_000);

const builderOverlay = document.getElementById("builderOverlay");
const builderFlavors = document.getElementById("builderFlavors");
const builderCount = document.getElementById("builderCount");
const builderBar = document.getElementById("builderBar");
const builderAdd = document.getElementById("builderAdd");
const builderHint = document.getElementById("builderHint");
let builderMode = "6";
let builderCounts = Array(products.length).fill(0);
let builderTrigger = null;

const BUILDER_CONFIG = {
  "6": {size: 6, price: 30, title: "Build a 6-Pack", sub: "Pick any six. Choose a favorite more than once if you like.", button: "Add 6-Pack — $30"},
  "3": {size: 3, price: 17, title: "Build a 3-Pack", sub: "Pick any three. Mix them up or repeat a favorite.", button: "Add 3-Pack — $17"},
  single: {size: null, price: 6, title: "Choose singles", sub: "Choose one or more bottles. Each single is $6.", button: "Add singles"}
};

function selectedBuilderTotal() {
  return builderCounts.reduce((sum, count) => sum + count, 0);
}

function renderBuilderFlavors() {
  builderFlavors.innerHTML = products.map((product, index) => `
    <div class="builder-flavor" style="--accent:${product.accent};--soft:${product.soft}">
      <span class="builder-flavor-icon" aria-hidden="true">${iconSvg(product.icon)}</span>
      <span class="builder-flavor-copy">
        <strong>${product.name}</strong>
        <small>${product.desc}</small>
      </span>
      <span class="builder-stepper">
        <button type="button" data-builder-minus="${index}" aria-label="Remove ${product.name}">−</button>
        <b data-builder-count="${index}" aria-live="polite">${builderCounts[index]}</b>
        <button type="button" data-builder-plus="${index}" aria-label="Add ${product.name}">+</button>
      </span>
    </div>
  `).join("");

  builderFlavors.querySelectorAll("[data-builder-minus]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.builderMinus);
      builderCounts[index] = Math.max(0, builderCounts[index] - 1);
      updateBuilder();
    });
  });

  builderFlavors.querySelectorAll("[data-builder-plus]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.builderPlus);
      const config = BUILDER_CONFIG[builderMode];
      if (config.size && selectedBuilderTotal() >= config.size) {
        toast(`Your ${config.size}-pack is full`);
        return;
      }
      if (!config.size && selectedBuilderTotal() >= 24) {
        toast("For more than 24 singles, please ask about bulk pricing");
        return;
      }
      builderCounts[index] += 1;
      updateBuilder();
    });
  });
}

function updateBuilder() {
  const config = BUILDER_CONFIG[builderMode];
  const total = selectedBuilderTotal();
  builderCounts.forEach((count, index) => {
    const label = builderFlavors.querySelector(`[data-builder-count="${index}"]`);
    if (label) label.textContent = count;
  });

  if (config.size) {
    builderCount.textContent = `${total} / ${config.size}`;
    builderBar.style.width = `${Math.min(100, (total / config.size) * 100)}%`;
    const remaining = config.size - total;
    builderHint.textContent = remaining ? `Choose ${remaining} more bottle${remaining === 1 ? "" : "s"} to continue.` : "Your pack is ready.";
    builderAdd.disabled = total !== config.size;
    builderAdd.textContent = config.button;
  } else {
    builderCount.textContent = `${total} bottle${total === 1 ? "" : "s"}`;
    builderBar.style.width = total ? "100%" : "0%";
    builderHint.textContent = total ? `${total} single${total === 1 ? "" : "s"} selected • ${money(total * 6)}` : "Choose at least one bottle to continue.";
    builderAdd.disabled = total < 1;
    builderAdd.textContent = total ? `Add ${total} single${total === 1 ? "" : "s"} — ${money(total * 6)}` : config.button;
  }
}

function openBuilder(mode, trigger, presetFlavors = []) {
  builderMode = String(mode);
  builderTrigger = trigger || document.activeElement;
  builderCounts = Array(products.length).fill(0);
  presetFlavors.forEach(flavor => {
    const index = products.findIndex(product => product.name === flavor);
    if (index >= 0) builderCounts[index] += 1;
  });

  const config = BUILDER_CONFIG[builderMode];
  document.getElementById("builderTitle").textContent = config.title;
  document.getElementById("builderSub").textContent = config.sub;
  document.getElementById("builderProgress").classList.toggle("singles", !config.size);
  renderBuilderFlavors();
  updateBuilder();
  builderOverlay.classList.add("open");
  builderOverlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  document.getElementById("closeBuilder").focus();
}

function closeBuilder() {
  builderOverlay.classList.remove("open");
  builderOverlay.setAttribute("aria-hidden", "true");
  if (!overlay.classList.contains("open")) document.body.style.overflow = "";
  if (builderTrigger && document.contains(builderTrigger)) builderTrigger.focus();
}

document.querySelectorAll("[data-shop-mode]").forEach(button => {
  button.addEventListener("click", () => openBuilder(button.dataset.shopMode, button));
});
document.getElementById("closeBuilder").addEventListener("click", closeBuilder);
builderOverlay.addEventListener("click", event => {
  if (event.target === builderOverlay) closeBuilder();
});

function addRegularSingle(name, qty) {
  const existing = cart.find(item => item.type === "single" && item.name === name && !item.bonus);
  if (existing) {
    existing.qty += qty;
    existing.price = existing.qty * 6;
  } else {
    cart.push({type: "single", name, qty, price: qty * 6});
  }
}

builderAdd.addEventListener("click", () => {
  const config = BUILDER_CONFIG[builderMode];
  const total = selectedBuilderTotal();
  if ((config.size && total !== config.size) || (!config.size && total < 1)) return;

  if (config.size) {
    const flavors = [];
    builderCounts.forEach((count, index) => {
      for (let number = 0; number < count; number += 1) flavors.push(products[index].name);
    });
    cart.push({type: "pack", size: config.size, price: config.price, flavors});
    toast(`${config.size}-pack added to your order`);
  } else {
    builderCounts.forEach((count, index) => {
      if (count) addRegularSingle(products[index].name, count);
    });
    toast(`${total} single${total === 1 ? "" : "s"} added to your order`);
  }

  save();
  closeBuilder();
});

function bottleCount() {
  return cart.reduce((sum, item) => sum + (item.type === "single" ? Number(item.qty || 0) : Number(item.size || 0)), 0);
}

function subtotal() {
  return cart.reduce((sum, item) => sum + Number(item.price || 0), 0);
}

function save() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCart();
}

function summarizePack(flavors) {
  const summary = (flavors || []).reduce((result, flavor) => {
    result[flavor] = (result[flavor] || 0) + 1;
    return result;
  }, {});
  return Object.entries(summary).map(([flavor, count]) => `${count}× ${flavor}`).join("<br>");
}

const upsellFlavor = document.getElementById("upsellFlavor");
upsellFlavor.innerHTML = products.map(product => `<option value="${product.name}">${product.name}</option>`).join("");

function canAddSixPackUpsell() {
  const packs = cart.filter(item => item.type === "pack" && Number(item.size) === 6).length;
  const bonuses = cart.filter(item => item.type === "single" && Number(item.bonus) === 6).length;
  return bonuses < packs;
}

function renderCart() {
  const count = bottleCount();
  const total = subtotal();
  document.getElementById("cartCount").textContent = count;
  document.getElementById("floatCount").textContent = count;
  document.getElementById("floatItems").textContent = `${count} bottle${count === 1 ? "" : "s"}`;
  document.getElementById("floatTotal").textContent = money(total);
  document.getElementById("subtotal").textContent = money(total);
  document.getElementById("floatingCart").classList.toggle("show", cart.length > 0);
  document.getElementById("cartUpsell").hidden = !canAddSixPackUpsell();

  const cartItems = document.getElementById("cartItems");
  if (!cart.length) {
    cartItems.innerHTML = '<div class="empty">Your order is empty. Choose a 6-pack, 3-pack, or singles to get started.</div>';
    return;
  }

  cartItems.innerHTML = cart.map((item, index) => `
    <div class="cart-item">
      <div>
        <h4>${item.type === "single" ? `${item.qty}× ${item.name}` : `Custom ${item.size}-Pack`}</h4>
        <p>${item.type === "pack" ? summarizePack(item.flavors) : `${money(item.price)}${item.bonus ? " • pack add-on" : ""}`}</p>
      </div>
      <button class="remove" type="button" data-remove="${index}" aria-label="Remove ${item.type === "single" ? item.name : `${item.size}-pack`}">Remove</button>
    </div>
  `).join("");

  cartItems.querySelectorAll("[data-remove]").forEach(button => {
    button.addEventListener("click", () => {
      cart.splice(Number(button.dataset.remove), 1);
      save();
    });
  });
}

document.getElementById("addUpsell").addEventListener("click", () => {
  if (!canAddSixPackUpsell()) return;
  cart.push({type: "single", name: upsellFlavor.value, qty: 1, price: 4, bonus: 6});
  save();
  toast(`${upsellFlavor.value} added for $4`);
});

const overlay = document.getElementById("overlay");
let cartTrigger = null;

function openCart(event) {
  cartTrigger = event?.currentTarget || document.activeElement;
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  document.getElementById("closeCart").focus();
}

function closeCart() {
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  if (!builderOverlay.classList.contains("open")) document.body.style.overflow = "";
  if (cartTrigger && document.contains(cartTrigger)) cartTrigger.focus();
}

document.getElementById("cartPill").addEventListener("click", openCart);
document.getElementById("floatingCart").addEventListener("click", openCart);
document.getElementById("closeCart").addEventListener("click", closeCart);
overlay.addEventListener("click", event => {
  if (event.target === overlay) closeCart();
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (builderOverlay.classList.contains("open")) closeBuilder();
  else if (overlay.classList.contains("open")) closeCart();
});

function toast(message) {
  const toastElement = document.getElementById("toast");
  toastElement.textContent = message;
  toastElement.classList.add("show");
  clearTimeout(window.rallyToastTimer);
  window.rallyToastTimer = setTimeout(() => toastElement.classList.remove("show"), 3200);
}

function parseStoredOrder(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function cloneStoredItems(items) {
  return JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));
}

function renderCoffeeClub() {
  const lastOrder = parseStoredOrder(LAST_ORDER_KEY);
  const favorite = parseStoredOrder(FAVORITE_PACK_KEY);
  const reorderButton = document.getElementById("reorderLast");
  const favoriteButton = document.getElementById("addFavorite");
  reorderButton.hidden = !lastOrder?.items?.length;
  favoriteButton.hidden = !favorite?.flavors?.length;
}

document.getElementById("reorderLast").addEventListener("click", event => {
  const lastOrder = parseStoredOrder(LAST_ORDER_KEY);
  if (!lastOrder?.items?.length) return;
  cart.push(...cloneStoredItems(lastOrder.items));
  save();
  toast("Last week’s order is back in your cart");
  openCart(event);
});

document.getElementById("addFavorite").addEventListener("click", event => {
  const favorite = parseStoredOrder(FAVORITE_PACK_KEY);
  if (!favorite?.flavors?.length) return;
  cart.push({type: "pack", size: 6, price: 30, flavors: [...favorite.flavors]});
  save();
  toast("Your favorite 6-pack is back in your cart");
  openCart(event);
});

function buildTextMessage() {
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const notes = document.getElementById("notes").value.trim();
  const deliveryInterest = document.getElementById("deliveryInterest").checked;
  const coffeeClubOptIn = document.getElementById("coffeeClubOptIn").checked;
  const lines = [
    "☕ RALLY POINT REFRESHMENTS ORDER",
    "",
    `Name: ${name || "(not entered)"}`,
    `Customer phone: ${phone || "(not entered)"}`,
    `Pickup: ${formatPickupDate(pickupDate)} at 10 AM in Henderson`,
    "Exact address and instructions by text. Preorder pickup only.",
    deliveryInterest ? "Delivery interest: Yes — please ask me about options" : "",
    coffeeClubOptIn ? "Coffee Club reminder consent: Yes" : "",
    "",
    "ORDER:"
  ].filter(Boolean);

  cart.forEach(item => {
    if (item.type === "single") lines.push(`${item.qty}× ${item.name}${item.bonus ? " (pack add-on)" : ""}`);
    else {
      lines.push(`${item.size}-Pack:`);
      item.flavors.forEach(flavor => lines.push(`• ${flavor}`));
    }
  });
  lines.push("", `Subtotal: ${money(subtotal())}`);
  if (notes) lines.push(`Notes: ${notes}`);
  return lines.join("\n");
}

document.getElementById("textOrder").addEventListener("click", () => {
  if (!cart.length) {
    toast("Add coffee before checking out");
    return;
  }
  window.location.href = `sms:${BUSINESS_PHONE}?body=${encodeURIComponent(buildTextMessage())}`;
});

document.getElementById("checkoutForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!cart.length) {
    toast("Add coffee before checking out");
    return;
  }

  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const email = document.getElementById("email").value.trim();
  const notes = document.getElementById("notes").value.trim();
  const website = document.getElementById("website").value.trim();
  const deliveryInterest = document.getElementById("deliveryInterest").checked;
  const coffeeClubOptIn = document.getElementById("coffeeClubOptIn").checked;

  if (name.length < 2) {
    toast("Enter your name");
    document.getElementById("name").focus();
    return;
  }
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 15 || /[a-zA-Z]/.test(phone)) {
    toast("Enter a valid phone number");
    document.getElementById("phone").focus();
    return;
  }

  const submitButton = document.getElementById("placeOrder");
  const originalButton = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.innerHTML = "<span>Preparing secure checkout…</span><small>Please wait</small>";

  try {
    const pendingCart = cloneStoredItems(cart);
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        customer: {name, phone, email},
        pickupDate: pickupIso,
        pickupWindow: PICKUP_WINDOW,
        notes,
        website,
        deliveryInterest,
        coffeeClubOptIn,
        paymentRequired: true,
        items: cart.map(item => ({
          type: item.type,
          name: item.name,
          qty: item.qty,
          size: item.size,
          flavors: item.flavors,
          bonus: item.bonus
        }))
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "We could not save the order.");
    if (!result.paymentPath) throw new Error("Online payment is temporarily unavailable. Please text us for help.");

    sessionStorage.setItem(PENDING_CART_KEY, JSON.stringify({items: pendingCart, orderNumber: result.orderNumber, savedAt: new Date().toISOString()}));
    sessionStorage.setItem("rallyPendingPayment", result.paymentPath);
    cart.splice(0, cart.length);
    localStorage.removeItem(CART_KEY);
    renderCart();
    event.target.reset();
    window.location.assign(result.paymentPath);
  } catch (error) {
    console.error(error);
    toast(`${error.message} You can use the text option below.`);
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = originalButton;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js?v=11").catch(() => {}));
}

renderCoffeeClub();
renderCart();
