import * as readline from "node:readline";
import chalk from "chalk";
import type { UserModel } from "../memory/user-model.js";
import { accents, gradient, palette } from "./theme.js";
import { revealBlock } from "./motion.js";

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

export async function runFirstTimeOnboarding(userModel: UserModel, existingRl?: readline.Interface): Promise<void> {
  const profile = userModel.getProfile();
  if (profile.name) return;

  const rl = existingRl || readline.createInterface({ input: process.stdin, output: process.stdout });
  const shouldClose = !existingRl;

  try {
    console.log("");
    await revealBlock(`  ${gradient("Welcome to NTOX", palette.accent, palette.violet)}`);
    console.log(chalk.dim("  A cognitive agent that learns how you work."));
    console.log("");

    const name = await ask(rl, `  ${accents.gold("?")} What should I call you? ${accents.soft("> ")} `);
    if (name && name.trim()) {
      userModel.setName(name.trim());
      console.log("");
      console.log(chalk.dim(`  Nice to meet you, `) + accents.title(name.trim()) + chalk.dim("."));
    }

    const purpose = await ask(
      rl,
      `  ${accents.gold("?")} What are you working on? ${accents.soft("(optional)")} ${accents.soft("> ")} `,
    );
    if (purpose && purpose.trim()) {
      userModel.extractFromConversation(`I work as ${purpose.trim()}`, false);
      console.log("");
      console.log(chalk.dim("  Noted."));
    }

    console.log("");
    console.log(`  ${accents.good("✓")} ${chalk.dim("Let's go.")}`);
    console.log("");
  } finally {
    if (shouldClose) rl.close();
  }
}
