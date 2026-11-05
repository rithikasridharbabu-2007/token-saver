import { Tiktoken } from "js-tiktoken/lite";
import o200k from "js-tiktoken/ranks/o200k_base";

let encoder;
export const TOKEN_ENCODING = "o200k_base";

// A reproducible local count, not a claim about a model's billed usage.
export function estimateTokens(text) {
  if (typeof text !== "string") throw new TypeError("Text must be a string.");
  encoder ??= new Tiktoken(o200k);
  return encoder.encode(text, [], []).length;
}
