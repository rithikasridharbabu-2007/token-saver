import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function fixture(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-saver-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

export function fakeCodex(t, mode = "success") {
  const root = fixture(t);
  const file = path.join(root, process.platform === "win32" ? "codex.cmd" : "codex");
  const script = path.join(root, "fake.cjs");
  fs.writeFileSync(script, [
    "const fs = require('node:fs');",
    "if (process.argv.includes('--version')) { console.log('codex-cli test'); process.exit(0); }",
    "let input='';",
    "process.stdin.setEncoding('utf8'); process.stdin.on('data', c => input += c);",
    "process.stdin.on('end', () => {",
    "fs.appendFileSync(" + JSON.stringify(path.join(root, "calls.jsonl")) + ", JSON.stringify({args:process.argv.slice(2), input, cwd:process.cwd()})+'\\n');",
    "const emit = e => process.stdout.write(JSON.stringify(e)+'\\n');",
    "emit({type:'thread.started',thread_id:'test-thread'});",
    "const mode = " + JSON.stringify(mode) + ";",
    "if(mode==='hang') { setInterval(()=>{}, 1000); return; }",
    "if(mode==='fail') { emit({type:'turn.failed',error:{message:'Synthetic provider failure'}}); process.exitCode=1; return; }",
    "if(mode==='invalid') { console.log('not JSON'); return; }",
    "if(mode==='empty') { emit({type:'turn.completed',usage:{input_tokens:12,output_tokens:0}}); return; }",
    "if(mode==='tool') emit({type:'item.started',item:{type:'command_execution',command:'never executed'}});",
    "const a=JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Answer from selected source.'}});",
    "process.stdout.write(a.slice(0,19));",
    "process.stdout.write(a.slice(19)+'\\n');",
    "process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:123,cached_input_tokens:40,output_tokens:17}}));",
    "});"
  ].join("\n"));
  fs.writeFileSync(file, process.platform === "win32"
    ? '@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\n'
    : "#!" + process.execPath + "\n" + fs.readFileSync(script, "utf8"), { mode: 0o755 });
  return { root, file, log: path.join(root, "calls.jsonl") };
}
