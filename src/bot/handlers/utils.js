export function normalizeCommandName(value) {
  return String(value || '').toLowerCase().replace(/^[!/]+/, '').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}
