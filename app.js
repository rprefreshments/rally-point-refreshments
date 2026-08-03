const BUSINESS_PHONE = "12522260557";
const CART_KEY = "rallyCartV4";

const products = [
  {
    name: "Brown Sugar Cinnamon Latte",
    icon: "🤎",
    desc: "Brown sugar sweetness with a cozy cinnamon finish.",
    tags: ["best"],
    badge: "Best seller"
  },
  {
    name: "Gourmet Sea Salt Caramel Latte",
    icon: "🧡",
    desc: "Rich caramel balanced with just enough sea salt.",
    tags: ["best"],
    badge: "Best seller"
  },
  {
    name: "Midnight Mocha Latte",
    icon: "🍫",
    desc: "Deep chocolate flavor for a bold, indulgent coffee.",
    tags: ["best", "chocolate"],
    badge: "Popular"
  },
  {
    name: "Double Vanilla Bean Oatmilk Latte",
    icon: "🤍",
    desc: "Silky oatmilk with a smooth double vanilla finish.",
    tags: []
  },
  {
    name: "Copycat Blondie Latte",
    icon: "💛",
    desc: "Creamy vanilla-caramel flavor inspired by a coffee-shop favorite.",
    tags: []
  },
  {
    name: "Sweet & Salty Hazelnut Latte",
    icon: "🌰",
    desc: "Toasty hazelnut with a balanced sweet-and-salty finish.",
    tags: []
  },
  {
    name: "White Chocolate Mocha Latte",
    icon: "🥛",
    desc: "Sweet white chocolate blended into a smooth, creamy latte.",
    tags: ["chocolate"]
  }
];

const cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
const money = value => `$${Number(value).toFixed(2).replace(".00", "")}`;
const productGrid = document.getElementById("productGrid");

function getNextSaturday() {
  const now = new Date();
  const day = now.getDay();
  let add = (6 - day + 7) % 7;
  if (add === 0 && now.getHours() >= 12) add = 7;
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
document.getElementById("pickupBanner").textContent = `Fresh pickup ${formatPickupDate(pickupDate)}`;
document.getElementById("pickupDateText").textContent = `${formatPickupDate(pickupDate)} pickup`;

productGrid.innerHTML = products.map((product, index) => `
  <article class="product-card" data-index="${index}" data-tags="${product.tags.join(" ")}">
    <div class="product-icon" aria-hidden="true">${product.icon}</div>

    <div class="product-copy">
      ${product.badge ? `<div class="product-meta"><span class="product-badge">${product.badge}</span></div>` : ""}
      <h3>${product.name}</h3>
      <p>${product.desc}</p>
    </div>

    <button class="quick-add" type="button" aria-label="Add ${product.name}">
      <span>+ Add</span>
      <small>$6</small>
    </button>
  </article>
`).join("");

document.querySelectorAll(".quick-add").forEach(button => {
  button.addEventListener("click", () => {
    const card = button.closest(".product-card");
    const product = products[Number(card.dataset.index)];
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
    button.innerHTML = "<span>Added ✓</span><small>$6</small>";
    setTimeout(() => {
      button.innerHTML = "<span>+ Add</span><small>$6</small>";
    }, 900);
  });
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
    cartItems.innerHTML = '<div class="empty">Your order is empty. Add a coffee to get started.</div>';
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
  const pickupWindow = document.getElementById("pickupWindow").value;
  const notes = document.getElementById("notes").value.trim();

  const lines = [
    "☕ RALLY POINT REFRESHMENTS ORDER",
    "",
    `Name: ${name || "(not entered)"}`,
    `Customer phone: ${phone || "(not entered)"}`,
    `Pickup: ${formatPickupDate(pickupDate)} — ${pickupWindow}`,
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
  window.location.href = `sms:${BUSINESS_PHONE}&body=${encodeURIComponent(buildTextMessage())}`;
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
  const pickupWindow = document.getElementById("pickupWindow").value;
  const notes = document.getElementById("notes").value.trim();
  const website = document.getElementById("website").value.trim();

  if (name.length < 2) {
    toast("Enter your name");
    document.getElementById("name").focus();
    return;
  }

  if (phone.replace(/\D/g, "").length < 10) {
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
        pickupWindow,
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
      `${formatPickupDate(pickupDate)} • ${pickupWindow}`;
    document.getElementById("confirmationTotal").textContent = money(result.subtotal / 100);

    cart.splice(0, cart.length);
    localStorage.removeItem(CART_KEY);
    renderCart();
    event.target.reset();
    document.getElementById("pickupWindow").value = "Afternoon";
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
    navigator.serviceWorker.register("/service-worker.js?v=4").catch(() => {});
  });
}

renderCart();
