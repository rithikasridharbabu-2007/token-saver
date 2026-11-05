import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { makeWorkbenchData, renderWorkbench } from "../lib/workbench.js";

const destination = fileURLToPath(new URL("../preview.html", import.meta.url));
fs.writeFileSync(destination, renderWorkbench(makeWorkbenchData()));
console.log("Updated preview.html from the current selection engine and demo source.");
