const localModeMessage = "\u001b[2m[@inariwatch/capture] Local mode — errors print to terminal. Set INARIWATCH_DSN or INARIWATCH_TOKEN+INARIWATCH_PROJECT_ID to send to cloud.\u001b[0m";
const write = console.log.bind(console);

console.log = (...args) => {
  if (args.length === 1 && args[0] === localModeMessage) return;
  write(...args);
};
