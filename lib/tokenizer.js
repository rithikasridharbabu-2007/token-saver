export function estimateTokens(text) {
  if (typeof text !== "string") {
    throw new TypeError("Text must be a string.");
  }

  return Math.ceil(text.length / 4);
}


