export function globToRegex(pattern: string, flags?: string): RegExp {
  const regex = pattern
    .replace(/\\/g, "\\\\")
    .replace(/\./g, "\\.")
    .replace(/\*\*\//g, "<<DS2>>")
    .replace(/\*\*/g, "<<DS>>")
    .replace(/\*/g, `[^\\\\/]*`)
    .replace(/\?/g, `[^\\\\/]`)
    .replace(/<<DS2>>/g, `(?:.*/)?`)
    .replace(/<<DS>>/g, `.*`);
  return new RegExp(`^${regex}$`, flags);
}
