export function uiScale(): number {
  const root = document.getElementById("root");
  return root ? Number.parseFloat(getComputedStyle(root).zoom) || 1 : 1;
}
