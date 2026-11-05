export function calculateTotal(items, discountCents = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  return Math.max(0, subtotal - discountCents);
}
