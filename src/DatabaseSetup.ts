// For use within GitHub Actions

import * as fs from "fs";
import * as path from "path";
import { Database } from "./Database";

const sql = fs.readFileSync(path.join(__dirname, "../DB_SETUP.sql"), "utf-8");

const statements = sql
.split("\n")
.map(line => line.replace(/--.*$/, "").trim())  // strip inline and full-line comments
.filter(line => !line.startsWith("#"))           // strip # comments
.join("\n")
.split(";")
.map(s => s.trim())
.filter(s => s.length > 0);

( async () => {
	for (const statement of statements) {
		await Database.query(statement);
	}

	await Database.destroy();
	console.log(`Setup complete - ${statements.length} statements executed`);
})();