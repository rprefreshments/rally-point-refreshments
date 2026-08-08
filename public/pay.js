const loadingCard = document.getElementById("loadingCard");
const checkoutShell = document.getElementById("checkoutShell");
const errorCard = document.getElementById("errorCard");
const successCard = document.getElementById("successCard");
const paymentForm = document.getElementById("paymentForm");
const payButton = document.getElementById("payButton");
const payButtonText = document.getElementById("payButtonText");
const paymentError = document.getElementById("paymentError");

let card;
let order;
let credentials;
let access;

function money(cents) {
  return new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"}).format(cents / 100);
}

function formatPickup(isoDate, windowLabel) {
  const date = new Date(`${isoDate}T12:00:00`);
  const formatted = new Intl.DateTimeFormat("en-US", {weekday: "short", month: "short", day: "numeric"}).format(date);
  return windowLabel === "Details confirmed by text" ? `${formatted}, 10 AM in Henderson` : `${formatted}, ${windowLabel}`;
}

function readAccessFromHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const orderNumber = params.get("order") || "";
  const accessToken = params.get("token") || "";
  if (!/^RP-[A-Z0-9-]+$/.test(orderNumber) || accessToken.length < 24) return null;
  return {orderNumber, accessToken};
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = new Error(data.error || "We could not complete that request.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function loadSquareScript(environment) {
  return new Promise((resolve, reject) => {
    if (window.Square) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    const host = environment === "sandbox" ? "sandbox.web.squarecdn.com" : "web.squarecdn.com";
    script.src = `https://${host}/v1/square.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Square's secure card form could not load. Please check your connection and try again."));
    document.head.appendChild(script);
  });
}

function showError(message, title = "We couldn’t open this payment.") {
  loadingCard.hidden = true;
  checkoutShell.hidden = true;
  successCard.hidden = true;
  errorCard.hidden = false;
  document.getElementById("errorTitle").textContent = title;
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("errorTitle").focus();
}

function showPaymentError(message) {
  paymentError.textContent = message;
  paymentError.hidden = false;
  paymentError.focus();
}

function renderOrder() {
  document.getElementById("orderNumber").textContent = order.orderNumber;
  document.getElementById("pickupDate").textContent = formatPickup(order.pickupDate, order.pickupWindow);
  document.getElementById("bottleCount").textContent = `${order.bottleCount} bottle${order.bottleCount === 1 ? "" : "s"}`;
  document.getElementById("orderTotal").textContent = money(order.amountCents);
  payButtonText.textContent = `Pay ${money(order.amountCents)}`;
}

function showSuccess(receiptUrl) {
  loadingCard.hidden = true;
  checkoutShell.hidden = true;
  errorCard.hidden = true;
  successCard.hidden = false;
  document.getElementById("successOrder").textContent = order.orderNumber;
  sessionStorage.removeItem("rallyPendingPayment");

  const savedUsual = savePaidOrderForReorder();
  if (savedUsual) {
    document.getElementById("successCopy").textContent = "Your order is paid and confirmed. We saved this order on this device for quick Coffee Club reordering.";
  }

  const receiptLink = document.getElementById("receiptLink");
  if (receiptUrl) {
    receiptLink.href = receiptUrl;
    receiptLink.hidden = false;
  }
  successCard.querySelector("h1").focus();
}

function savePaidOrderForReorder() {
  try {
    const pending = JSON.parse(sessionStorage.getItem("rallyPendingOrderCartV1") || "null");
    if (!pending || pending.orderNumber !== order.orderNumber || !Array.isArray(pending.items) || !pending.items.length) return false;

    localStorage.setItem("rallyLastOrderV1", JSON.stringify({
      orderNumber: order.orderNumber,
      paidAt: new Date().toISOString(),
      items: pending.items
    }));

    const favoriteSixPack = [...pending.items].reverse().find(item =>
      item?.type === "pack" && Number(item.size) === 6 && Array.isArray(item.flavors) && item.flavors.length === 6
    );
    if (favoriteSixPack) {
      localStorage.setItem("rallyFavoriteSixPackV1", JSON.stringify({
        savedAt: new Date().toISOString(),
        flavors: favoriteSixPack.flavors
      }));
    }

    sessionStorage.removeItem("rallyPendingOrderCartV1");
    return true;
  } catch {
    return false;
  }
}

async function initializePayment() {
  loadingCard.hidden = false;
  checkoutShell.hidden = true;
  errorCard.hidden = true;
  successCard.hidden = true;
  paymentError.hidden = true;

  access = readAccessFromHash();
  if (!access) {
    showError("This payment link is missing order information. Please return to the shop and check out again.");
    return;
  }

  try {
    const [configResponse, summary] = await Promise.all([
      fetch("/api/square/config", {cache: "no-store"}).then(response => response.json()),
      postJson("/api/payments/order-summary", access)
    ]);

    if (!configResponse.ok || !configResponse.enabled) {
      throw new Error("Online card payment is temporarily unavailable. Please text us and we’ll help finish your order.");
    }

    credentials = configResponse;
    order = summary.order;
    renderOrder();

    if (order.paymentStatus === "COMPLETED") {
      showSuccess(order.receiptUrl);
      return;
    }
    if (order.paymentStatus === "PROCESSING") {
      throw new Error("Square is still confirming this payment. Please do not submit it again. Check your email, or text us if it does not update shortly.");
    }

    if (!window.isSecureContext) {
      throw new Error("Secure card entry requires an HTTPS connection. Please reopen this page at rallypointrefreshments.com.");
    }

    await loadSquareScript(credentials.environment);
    const payments = window.Square.payments(credentials.applicationId, credentials.locationId);
    card = await payments.card();
    await card.attach("#cardContainer");

    loadingCard.hidden = true;
    checkoutShell.hidden = false;
    payButton.disabled = false;
  } catch (error) {
    console.error(error);
    showError(error.message || "The secure payment form could not load. Please try again.");
  }
}

paymentForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!card || !order || payButton.disabled) return;

  paymentError.hidden = true;
  payButton.disabled = true;
  payButton.classList.add("processing");
  payButtonText.textContent = "Processing payment…";

  try {
    const tokenResult = await card.tokenize({
      amount: (order.amountCents / 100).toFixed(2),
      billingContact: order.customer,
      intent: "CHARGE",
      customerInitiated: true,
      sellerKeyedIn: false,
      currencyCode: "USD"
    });

    if (tokenResult.status !== "OK" || !tokenResult.token) {
      const detail = tokenResult.errors?.[0]?.message;
      throw new Error(detail || "Please check the card details and try again.");
    }

    const result = await postJson("/api/payments", {
      ...access,
      sourceId: tokenResult.token
    });
    showSuccess(result.receiptUrl);
  } catch (error) {
    console.error(error);
    showPaymentError(error.message || "The payment could not be completed. Please try again.");
    payButton.disabled = false;
    payButton.classList.remove("processing");
    payButtonText.textContent = `Pay ${money(order.amountCents)}`;
  }
});

document.getElementById("retryButton").addEventListener("click", initializePayment);

window.addEventListener("error", event => {
  if (event.target?.src?.includes("square.js")) {
    showError("Square's secure card form could not load. Please check your connection and try again.");
  }
}, true);

initializePayment();
