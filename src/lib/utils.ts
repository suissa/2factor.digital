export function cn(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ');
}

export function formatTimeLeft(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${seconds}s`;
}
