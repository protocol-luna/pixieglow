async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case "bot":
    case undefined: {
      const { startBot } = await import("./bot/matrix-bot.js");
      await startBot();
      break;
    }

    default: {
      console.error("Usage: bun run src/index.ts [bot]");
      process.exit(1);
    }
  }
}

void main();

export {};
