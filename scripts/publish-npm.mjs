#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import process from "node:process";
import packageJson from "../package.json" with { type: "json" };

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipTests = args.has("--skip-tests");
const yes = args.has("--yes") || process.env.CI === "true";
const version = packageJson.version;
const packageName = packageJson.name;

function npmCommand(commandArgs) {
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmCli)) {
    return {
      command: process.execPath,
      args: [npmCli, ...commandArgs],
      rendered: ["npm", ...commandArgs].join(" "),
    };
  }

  return {
    command: "npm",
    args: commandArgs,
    rendered: ["npm", ...commandArgs].join(" "),
  };
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const invocation = command === "npm"
      ? npmCommand(commandArgs)
      : { command, args: commandArgs, rendered: [command, ...commandArgs].join(" ") };
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: { ...process.env, ...options.env },
    });

    let stdout = "";
    let stderr = "";

    if (options.capture) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      reject(new Error(`${invocation.rendered} failed with exit code ${code}\n${stderr.trim()}`));
    });
  });
}

async function npmViewVersion() {
  try {
    const { stdout } = await run("npm", ["view", `${packageName}@${version}`, "version"], {
      capture: true,
    });
    return stdout || null;
  } catch {
    return null;
  }
}

async function npmWhoami() {
  const token = process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN;
  if (token) {
    return "token auth";
  }

  try {
    const { stdout } = await run("npm", ["whoami"], { capture: true });
    return stdout;
  } catch {
    return null;
  }
}

async function promptForOtp() {
  if (process.env.NPM_OTP) {
    return process.env.NPM_OTP;
  }

  if (yes) {
    return null;
  }

  const rl = createInterface({ input, output });
  try {
    const otp = await rl.question(
      "npm 2FA code, if your account requires one. Press Enter to try without it: ",
    );
    return otp.trim() || null;
  } finally {
    rl.close();
  }
}

async function confirmPublish() {
  if (yes || dryRun) {
    return;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Publish ${packageName}@${version} to npm latest? Type yes: `);
    if (answer.trim().toLowerCase() !== "yes") {
      throw new Error("Publish cancelled.");
    }
  } finally {
    rl.close();
  }
}

async function main() {
  console.log(`Preparing ${packageName}@${version} for npm ${dryRun ? "dry run" : "publish"}...`);

  const existingVersion = await npmViewVersion();
  if (existingVersion === version && !dryRun) {
    throw new Error(`${packageName}@${version} is already published on npm.`);
  }

  const identity = await npmWhoami();
  if (!identity && !dryRun) {
    throw new Error(
      "npm is not authenticated. Run npm login --auth-type=web, or set NPM_TOKEN/NODE_AUTH_TOKEN.",
    );
  }

  if (identity) {
    console.log(`npm auth: ${identity}`);
  }

  await run("npm", ["run", "build"]);

  if (!skipTests) {
    await run("npm", ["test"]);
  }

  await run("npm", ["pack", "--dry-run"]);

  if (dryRun) {
    console.log(`Dry run complete for ${packageName}@${version}.`);
    return;
  }

  await confirmPublish();

  const otp = await promptForOtp();
  const publishArgs = ["publish", "--access", "public"];
  if (otp) {
    publishArgs.push(`--otp=${otp}`);
  }

  await run("npm", publishArgs, {
    env: process.env.NPM_TOKEN ? { NODE_AUTH_TOKEN: process.env.NPM_TOKEN } : {},
  });

  const { stdout } = await run("npm", ["view", packageName, "version"], { capture: true });
  console.log(`${packageName} latest is now ${stdout}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
