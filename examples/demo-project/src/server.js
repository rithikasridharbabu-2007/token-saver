import { signIn } from "./auth.js";
import { checkout } from "./checkout.js";

export const routes = {
  "/login": signIn,
  "/checkout": checkout
};

console.log("Demo route map loaded. Supply your own server and adapters.");
