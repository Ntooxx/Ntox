export function globToRegex(pattern: string): RegExp {
  const regex = pattern
    .replace(/\\/g, "\\\\")
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "<<DS>>")
    .replace(/\*/g, `[^\\\\/]*`)
    .replace(/<<DS>>/g, `.*`)
    .replace(/\?/g, `[^\\\\/]`);
  return new RegExp(`^${regex}$`);
}
