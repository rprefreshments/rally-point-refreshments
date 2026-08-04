const BUSINESS_PHONE = "12522260557";
const CART_KEY = "rallyCartV6";
const PICKUP_WINDOW = "Details confirmed by text";

const products = [
  {
    name: "Brown Sugar Cinnamon Latte",
    icon: "cinnamon",
    accent: "#9b4b24",
    soft: "#f4dfce",
    desc: "Brown sugar sweetness with a cozy cinnamon finish.",
    tags: ["best"],
    badge: "Best seller"
  },
  {
    name: "Gourmet Sea Salt Caramel Latte",
    icon: "caramel",
    accent: "#d16a13",
    soft: "#ffead3",
    desc: "Rich caramel balanced with just enough sea salt.",
    tags: ["best"],
    badge: "Best seller"
  },
  {
    name: "Midnight Mocha Latte",
    icon: "mocha",
    accent: "#6c3525",
    soft: "#ead8d1",
    desc: "Deep chocolate flavor for a bold, indulgent coffee.",
    tags: ["best", "chocolate"],
    badge: "Popular"
  },
  {
    name: "Double Vanilla Bean Oatmilk Latte",
    icon: "vanilla",
    accent: "#94712f",
    soft: "#f5e9c8",
    desc: "Silky oatmilk with a smooth double vanilla finish.",
    tags: []
  },
  {
    name: "Copycat Blondie Latte",
    icon: "blondie",
    accent: "#bc820c",
    soft: "#fff0ba",
    desc: "Creamy vanilla-caramel flavor inspired by a coffee-shop favorite.",
    tags: []
  },
  {
    name: "Sweet & Salty Hazelnut Latte",
    icon: "hazelnut",
    accent: "#7f3d21",
    soft: "#eddbcf",
    desc: "Toasty hazelnut with a balanced sweet-and-salty finish.",
    tags: []
  },
  {
    name: "White Chocolate Mocha Latte",
    icon: "white-chocolate",
    accent: "#8f6d55",
    soft: "#f4e9e1",
    desc: "Sweet white chocolate blended into a smooth, creamy latte.",
    tags: ["chocolate"]
  }
];

const cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
const money = value => `$${Number(value).toFixed(2).replace(".00", "")}`;
const productGrid = document.getElementById("productGrid");
const featuredGrid = document.getElementById("featuredGrid");

function iconSvg(type) {
  const icons = {
    cinnamon: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M18 44 43 19c4-4 10 2 6 6L24 50c-4 4-10-2-6-6Z"/>
        <path d="m22 39 7 7M29 32l7 7M36 25l7 7"/>
        <path d="M16 19c7-6 18-3 20 5-8-4-15-2-20 5 1-4 1-7 0-10Z"/>
      </svg>`,
    caramel: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 9c8 12 15 20 15 30a15 15 0 1 1-30 0c0-10 7-18 15-30Z"/>
        <path d="M24 39c2 6 7 9 13 8"/>
        <path d="M49 17h7M52.5 13.5v7M8 24h7M11.5 20.5v7"/>
      </svg>`,
    mocha: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M15 21h34v22c0 7-6 12-13 12h-8c-7 0-13-5-13-12V21Z"/>
        <path d="M49 27h4c6 0 6 13 0 13h-4"/>
        <path d="M23 13c0 4 4 4 4 8M34 10c0 5 5 5 5 10"/>
        <path d="M23 36c6-5 12-5 18 0-6 5-12 5-18 0Z"/>
      </svg>`,
    vanilla: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M31 31c-8-2-13-8-11-14 7-1 13 4 14 12"/>
        <path d="M33 31c2-8 8-13 14-11 1 7-4 13-12 14"/>
        <path d="M32 34c8 2 13 8 11 14-7 1-13-4-14-12"/>
        <path d="M30 33c-2 8-8 13-14 11-1-7 4-13 12-14"/>
        <circle cx="32" cy="32" r="4"/>
        <path d="M48 48 56 56M44 52l8 8"/>
      </svg>`,
    blondie: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="m32 8 5.5 13.5L51 27l-13.5 5.5L32 46l-5.5-13.5L13 27l13.5-5.5L32 8Z"/>
        <path d="m49 42 2.5 6.5L58 51l-6.5 2.5L49 60l-2.5-6.5L40 51l6.5-2.5L49 42Z"/>
        <path d="m14 38 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z"/>
      </svg>`,
    hazelnut: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M20 24c7-8 17-8 24 0 6 7 5 19-3 27-5 5-13 5-18 0-8-8-9-20-3-27Z"/>
        <path d="M20 24c2-8 8-13 16-13 2 7-1 13-8 17"/>
        <path d="M24 29c5 3 11 3 16 0"/>
      </svg>`,
    "white-chocolate": `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M13 17h38v34H13z"/>
        <path d="M25.7 17v34M38.3 17v34M13 28.3h38M13 39.7h38"/>
        <path d="M44 9c5 4 7 8 7 12"/>
      </svg>`
  };

  return icons[type] || icons.mocha;
}

// Orders close Thursday at 6pm for that week's Saturday pickup.
// After the cutoff, the next available pickup rolls to the following Saturday.
const ORDER_CUTOFF_DAY = 4;   // Thursday
const ORDER_CUTOFF_HOUR = 18; // 6pm

function getOrderDeadline(forPickup) {
  const deadline = new Date(forPickup);
  deadline.setDate(forPickup.getDate() - 2); // Thursday before Saturday
  deadline.setHours(ORDER_CUTOFF_HOUR, 0, 0, 0);
  return deadline;
}

function getNextSaturday() {
  const now = new Date();
  const day = now.getDay();
  let add = (6 - day + 7) % 7;

  // Already Saturday, or past this week's Thursday 6pm cutoff -> next week.
  const pastCutoff =
    day > ORDER_CUTOFF_DAY ||
    (day === ORDER_CUTOFF_DAY && now.getHours() >= ORDER_CUTOFF_HOUR);

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
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(date);
}

const pickupDate = getNextSaturday();
const pickupIso = toLocalIsoDate(pickupDate);
const orderDeadline = getOrderDeadline(pickupDate);
document.getElementById("pickupBanner").textContent = `Fresh pickup ${formatPickupDate(pickupDate)}`;
document.getElementById("pickupDateText").textContent = `${formatPickupDate(pickupDate)} pickup`;

function renderDeadlineCountdown() {
  const target = document.getElementById("orderDeadline");
  if (!target) return;

  const msLeft = orderDeadline - new Date();
  if (msLeft <= 0) {
    target.textContent = "Ordering now open";
    return;
  }

  const hoursLeft = Math.floor(msLeft / 3_600_000);
  const daysLeft = Math.floor(hoursLeft / 24);

  if (daysLeft >= 2) {
    target.textContent = `${daysLeft} days left to order`;
  } else if (hoursLeft >= 24) {
    target.textContent = "1 day left to order";
  } else if (hoursLeft >= 1) {
    target.textContent = `Only ${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"} left to order`;
  } else {
    target.textContent = "Last call — ordering closes soon";
  }
}

renderDeadlineCountdown();
setInterval(renderDeadlineCountdown, 60_000);

function productCard(product, index, featured = false) {
  return `
    <article
      class="${featured ? "favorite-card" : "product-card"}"
      data-index="${index}"
      data-tags="${product.tags.join(" ")}"
      style="--accent:${product.accent};--soft:${product.soft}"
    >
      ${featured ? '<span class="favorite-rank">Customer favorite</span>' : ""}
      <div class="product-icon" aria-hidden="true">${iconSvg(product.icon)}</div>

      <div class="product-copy">
        ${product.badge ? `<div class="product-meta"><span class="product-badge">${product.badge}</span></div>` : ""}
        <h3>${product.name}</h3>
        <p>${product.desc}</p>
      </div>

      <button class="quick-add" type="button" data-product-index="${index}" aria-label="Add ${product.name}">
        <span>+ Add</span>
        <small>$6</small>
      </button>
    </article>
  `;
}

featuredGrid.innerHTML = products
  .map((product, index) => ({product, index}))
  .filter(({product}) => product.tags.includes("best"))
  .slice(0, 3)
  .map(({product, index}) => productCard(product, index, true))
  .join("");

productGrid.innerHTML = products.map((product, index) => productCard(product, index)).join("");

document.addEventListener("click", event => {
  const button = event.target.closest(".quick-add");
  if (!button) return;

  const product = products[Number(button.dataset.productIndex)];
  const existing = cart.find(item => item.type === "single" && item.name === product.name);

  if (existing) {
    existing.qty += 1;
    existing.price += 6;
  } else {
    cart.push({
      type: "single",
      name: product.name,
      qty: 1,
      price: 6
    });
  }

  save();
  toast(`${product.name} added`);

  const original = button.innerHTML;
  button.innerHTML = "<span>Added ✓</span><small>$6</small>";
  setTimeout(() => {
    button.innerHTML = original;
  }, 900);
});

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach(item => item.classList.remove("active"));
    button.classList.add("active");

    const filter = button.dataset.filter;
    document.querySelectorAll(".product-card").forEach(card => {
      const show = filter === "all" || card.dataset.tags.split(" ").includes(filter);
      card.hidden = !show;
    });
  });
});

document.querySelectorAll(".pack-card").forEach(card => {
  const size = Number(card.dataset.packSize);
  const price = Number(card.dataset.price);
  const counts = Array(products.length).fill(0);
  const options = card.querySelector(".pack-options");
  const countLabel = card.querySelector(".pack-count");
  const progressBar = card.querySelector(".progress-bar");
  const addButton = card.querySelector(".pack-add");

  options.innerHTML = products.map((product, index) => `
    <div class="pack-option">
      <span>${product.name}</span>
      <div class="mini">
        <button type="button" data-minus="${index}" aria-label="Remove ${product.name}">−</button>
        <b data-count="${index}">0</b>
        <button type="button" data-plus="${index}" aria-label="Add ${product.name}">+</button>
      </div>
    </div>
  `).join("");

  const selectedTotal = () => counts.reduce((sum, count) => sum + count, 0);

  function updatePack() {
    const total = selectedTotal();
    countLabel.textContent = `${total} / ${size}`;
    progressBar.style.width = `${Math.min(100, (total / size) * 100)}%`;

    counts.forEach((count, index) => {
      card.querySelector(`[data-count="${index}"]`).textContent = count;
    });

    const ready = total === size;
    addButton.disabled = !ready;
    addButton.classList.toggle("ready", ready);
  }

  card.querySelectorAll("[data-plus]").forEach(button => {
    button.addEventListener("click", () => {
      if (selectedTotal() >= size) {
        toast(`Your ${size}-pack is full`);
        return;
      }
      counts[Number(button.dataset.plus)] += 1;
      updatePack();
    });
  });

  card.querySelectorAll("[data-minus]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.minus);
      counts[index] = Math.max(0, counts[index] - 1);
      updatePack();
    });
  });

  addButton.addEventListener("click", () => {
    if (selectedTotal() !== size) return;

    const flavors = [];
    counts.forEach((count, index) => {
      for (let i = 0; i < count; i += 1) flavors.push(products[index].name);
      counts[index] = 0;
    });

    cart.push({
      type: "pack",
      size,
      price,
      flavors
    });

    updatePack();
    save();
    toast(`${size}-pack added`);
  });

  updatePack();
});

function bottleCount() {
  return cart.reduce((sum, item) => sum + (item.type === "single" ? item.qty : item.size), 0);
}

function subtotal() {
  return cart.reduce((sum, item) => sum + item.price, 0);
}

function save() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCart();
}

function summarizePack(flavors) {
  const summary = flavors.reduce((result, flavor) => {
    result[flavor] = (result[flavor] || 0) + 1;
    return result;
  }, {});

  return Object.entries(summary)
    .map(([flavor, count]) => `${count}× ${flavor}`)
    .join("<br>");
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

  const cartItems = document.getElementById("cartItems");

  if (!cart.length) {
    cartItems.innerHTML = '<div class="empty">Your order is empty. Build a 6-pack or add a bottle to get started.</div>';
    return;
  }

  cartItems.innerHTML = cart.map((item, index) => `
    <div class="cart-item">
      <div>
        <h4>${item.type === "single" ? `${item.qty}× ${item.name}` : `Custom ${item.size}-Pack`}</h4>
        <p>${item.type === "pack" ? summarizePack(item.flavors) : money(item.price)}</p>
      </div>
      <button class="remove" type="button" data-remove="${index}">Remove</button>
    </div>
  `).join("");

  cartItems.querySelectorAll("[data-remove]").forEach(button => {
    button.addEventListener("click", () => {
      cart.splice(Number(button.dataset.remove), 1);
      save();
    });
  });
}

const overlay = document.getElementById("overlay");

function openCart() {
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeCart() {
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

document.getElementById("cartPill").addEventListener("click", openCart);
document.getElementById("floatingCart").addEventListener("click", openCart);
document.getElementById("closeCart").addEventListener("click", closeCart);

overlay.addEventListener("click", event => {
  if (event.target === overlay) closeCart();
});

function toast(message) {
  const toastElement = document.getElementById("toast");
  toastElement.textContent = message;
  toastElement.classList.add("show");
  clearTimeout(window.rallyToastTimer);
  window.rallyToastTimer = setTimeout(() => {
    toastElement.classList.remove("show");
  }, 1800);
}

function buildTextMessage() {
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const notes = document.getElementById("notes").value.trim();

  const lines = [
    "☕ RALLY POINT REFRESHMENTS ORDER",
    "",
    `Name: ${name || "(not entered)"}`,
    `Customer phone: ${phone || "(not entered)"}`,
    `Pickup: ${formatPickupDate(pickupDate)} — details confirmed by text`,
    "",
    "ORDER:"
  ];

  cart.forEach(item => {
    if (item.type === "single") {
      lines.push(`${item.qty}× ${item.name}`);
    } else {
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

const confirmationOverlay = document.getElementById("confirmationOverlay");
document.getElementById("closeConfirmation").addEventListener("click", () => {
  confirmationOverlay.classList.remove("open");
  confirmationOverlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
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
  submitButton.innerHTML = "<span>Saving order…</span><small>Please wait</small>";

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        customer: {name, phone, email},
        pickupDate: pickupIso,
        pickupWindow: PICKUP_WINDOW,
        notes,
        website,
        items: cart.map(item => ({
          type: item.type,
          name: item.name,
          qty: item.qty,
          size: item.size,
          flavors: item.flavors
        }))
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "We could not save the order.");
    }

    document.getElementById("confirmationNumber").textContent = result.orderNumber;
    document.getElementById("confirmationPickup").textContent =
      `${formatPickupDate(pickupDate)} • Details by text`;
    document.getElementById("confirmationTotal").textContent = money(result.subtotal / 100);

    cart.splice(0, cart.length);
    localStorage.removeItem(CART_KEY);
    renderCart();
    event.target.reset();
    closeCart();

    confirmationOverlay.classList.add("open");
    confirmationOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  } catch (error) {
    console.error(error);
    toast(`${error.message} You can use the text option below.`);
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = originalButton;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js?v=7").catch(() => {});
  });
}

renderCart();
