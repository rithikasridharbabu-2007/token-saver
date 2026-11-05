import { calculateTotal } from "./pricing.js";

export async function checkout(cart, payments) {
  const totalCents = calculateTotal(cart.items, cart.discountCents);
  return payments.charge({ amountCents: totalCents, currency: "USD" });
}
