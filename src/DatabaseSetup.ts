// For use within GitHub Actions

import * as fs from "fs";
import * as path from "path";
import { Database } from "./Database";

const sql = fs.readFileSync(path.join(__dirname, "../DB_SETUP.sql"), "utf-8");

// Split on semicolons to run each statement individually
const statements = sql
.split(";")
.map(s => s.trim())
.filter(s => s.length > 0 && !s.startsWith("#") && !s.startsWith("--"));

( async () => {
	for (const statement of statements) {
		await Database.query(statement);
	}

	await Database.destroy();
	console.log(`Setup complete - ${statements.length} statements executed`);
})();