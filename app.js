
const BUSINESS_PHONE="12522260557";
const products=[
 {name:"Double Vanilla Bean Oatmilk Latte",icon:"🤍",desc:"Silky oatmilk with a smooth double hit of vanilla bean."},
 {name:"Brown Sugar Cinnamon Latte",icon:"🤎",desc:"Warm brown sugar flavor finished with a cozy cinnamon note."},
 {name:"Gourmet Sea Salt Caramel Latte",icon:"🧡",desc:"Rich caramel balanced with just enough sea salt."},
 {name:"Copycat Blondie Latte",icon:"💛",desc:"A creamy dessert-style latte with smooth vanilla-caramel flavor."},
 {name:"Sweet & Salty Hazelnut Latte",icon:"🌰",desc:"Toasty hazelnut with a balanced sweet-and-salty finish."},
 {name:"Midnight Mocha Latte",icon:"🍫",desc:"Deep chocolate flavor for a bold, indulgent coffee."},
 {name:"White Chocolate Mocha Latte",icon:"🥛",desc:"Sweet white chocolate blended into a smooth, creamy latte."}
];
const cart=JSON.parse(localStorage.getItem("rallyCart")||"[]");
const money=n=>`$${Number(n).toFixed(2).replace(".00","")}`;
const grid=document.getElementById("productGrid");

grid.innerHTML=products.map((p,i)=>`<article class="product-card" data-i="${i}">
 <div class="product-top"><span class="product-icon">${p.icon}</span><strong>$6</strong></div>
 <h3>${p.name}</h3><p>${p.desc}</p>
 <div class="product-actions"><div class="qty"><button class="minus">−</button><b>1</b><button class="plus">+</button></div><button class="add">Add $6</button></div>
</article>`).join("");

document.querySelectorAll(".product-card").forEach(card=>{
 let q=1; const label=card.querySelector(".qty b"),add=card.querySelector(".add"),p=products[+card.dataset.i];
 const update=()=>{label.textContent=q;add.textContent=`Add ${money(q*6)}`};
 card.querySelector(".minus").onclick=()=>{q=Math.max(1,q-1);update()};
 card.querySelector(".plus").onclick=()=>{q=Math.min(24,q+1);update()};
 add.onclick=()=>{cart.push({type:"single",name:p.name,qty:q,price:q*6});q=1;update();save();toast(`${p.name} added`)};
});

document.querySelectorAll(".pack-card").forEach(card=>{
 const size=+card.dataset.packSize,price=+card.dataset.price,counts=Array(products.length).fill(0);
 const opts=card.querySelector(".pack-options"),count=card.querySelector(".pack-count"),add=card.querySelector(".pack-add");
 opts.innerHTML=products.map((p,i)=>`<div class="pack-option"><span>${p.name}</span><div class="mini"><button data-m="${i}">−</button><b data-c="${i}">0</b><button data-p="${i}">+</button></div></div>`).join("");
 const total=()=>counts.reduce((a,b)=>a+b,0);
 const update=()=>{count.textContent=`${total()} / ${size}`;counts.forEach((n,i)=>card.querySelector(`[data-c="${i}"]`).textContent=n);add.disabled=total()!==size;add.classList.toggle("ready",total()===size)};
 card.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{if(total()<size)counts[+b.dataset.p]++;update()});
 card.querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>{counts[+b.dataset.m]=Math.max(0,counts[+b.dataset.m]-1);update()});
 add.onclick=()=>{const flavors=[];counts.forEach((n,i)=>{for(let x=0;x<n;x++)flavors.push(products[i].name);counts[i]=0});cart.push({type:"pack",size,price,flavors});update();save();toast(`${size}-pack added`)};
 update();
});

function bottleCount(){return cart.reduce((s,x)=>s+(x.type==="single"?x.qty:x.size),0)}
function subtotal(){return cart.reduce((s,x)=>s+x.price,0)}
function save(){localStorage.setItem("rallyCart",JSON.stringify(cart));render()}
function render(){
 const count=bottleCount(),total=subtotal();
 document.getElementById("cartCount").textContent=count;document.getElementById("floatCount").textContent=count;
 document.getElementById("floatTotal").textContent=money(total);document.getElementById("subtotal").textContent=money(total);
 document.getElementById("floatingCart").classList.toggle("show",cart.length>0);
 const wrap=document.getElementById("cartItems");
 wrap.innerHTML=cart.length?cart.map((x,i)=>`<div class="cart-item"><div><h4>${x.type==="single"?`${x.qty}× ${x.name}`:`Custom ${x.size}-Pack`}</h4><p>${x.type==="pack"?x.flavors.join("<br>"):money(x.price)}</p></div><button class="remove" data-r="${i}">Remove</button></div>`).join(""):`<div class="empty">Your order is empty.</div>`;
 wrap.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{cart.splice(+b.dataset.r,1);save()});
}
const overlay=document.getElementById("overlay");
function openCart(){overlay.classList.add("open");overlay.setAttribute("aria-hidden","false");document.body.style.overflow="hidden"}
function closeCart(){overlay.classList.remove("open");overlay.setAttribute("aria-hidden","true");document.body.style.overflow=""}
document.getElementById("cartPill").onclick=openCart;document.getElementById("floatingCart").onclick=openCart;document.getElementById("closeCart").onclick=closeCart;
overlay.onclick=e=>{if(e.target===overlay)closeCart()};
function toast(t){const el=document.getElementById("toast");el.textContent=t;el.classList.add("show");clearTimeout(window.tt);window.tt=setTimeout(()=>el.classList.remove("show"),1500)}
document.getElementById("textOrder").onclick=()=>{
 if(!cart.length)return toast("Add coffee first");
 const name=document.getElementById("name").value.trim(),phone=document.getElementById("phone").value.trim(),date=document.getElementById("date").value,time=document.getElementById("time").value,notes=document.getElementById("notes").value.trim();
 if(!name||!phone)return toast("Enter your name and phone");
 let lines=["☕ RALLY POINT REFRESHMENTS ORDER","",`Name: ${name}`,`Phone: ${phone}`];
 if(date)lines.push(`Pickup date: ${date}`);if(time)lines.push(`Pickup time: ${time}`);lines.push("","ORDER:");
 cart.forEach(x=>{if(x.type==="single")lines.push(`${x.qty}× ${x.name}`);else{lines.push(`${x.size}-Pack:`);x.flavors.forEach(f=>lines.push(`• ${f}`))}});
 lines.push("",`Subtotal: ${money(subtotal())}`);if(notes)lines.push(`Notes: ${notes}`);
 location.href=`sms:${BUSINESS_PHONE}&body=${encodeURIComponent(lines.join("\n"))}`;
};
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));
render();
