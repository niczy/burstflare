#!/usr/bin/env node
// @ts-check

import { runCli } from "../src/cli.js";

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
