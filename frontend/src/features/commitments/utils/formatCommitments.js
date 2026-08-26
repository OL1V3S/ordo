export function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

export function formatDate(value) {
  if (!value) return "Unknown date";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
