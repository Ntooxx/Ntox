import * as readline from "node:readline";
import chalk from "chalk";
import type { UserModel } from "../memory/user-model.js";

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function runFirstTimeOnboarding(userModel: UserModel): Promise<void> {
  const profile = userModel.getProfile();
  if (profile.name) return;

  console.log("");
  console.log(chalk.dim("  Welcome to Ntox."));
  console.log("");

  const name = await ask(chalk.rgb(255, 183, 77)("  What should I call you? ") + chalk.dim("> "));
  if (name && name.trim()) {
    userModel.setName(name.trim());
    console.log("");
    console.log(chalk.dim(`  Nice to meet you, ${name.trim()}.`));
  }

  const purpose = await ask(chalk.rgb(255, 183, 77)("  What are you working on? ") + chalk.dim("(optional) > "));
  if (purpose && purpose.trim()) {
    userModel.extractFromConversation(`I work as ${purpose.trim()}`, false);
    console.log("");
    console.log(chalk.dim("  Noted."));
  }

  console.log("");
  console.log(chalk.dim("  Let's go."));
  console.log("");
}
