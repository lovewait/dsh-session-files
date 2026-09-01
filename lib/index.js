/**
 * dsh-session-files — host half.
 *
 * A read-only workspace file pointer for the CURRENT session. Unlike
 * dsh-workspace-explorer (which enumerates every registered workspace), this
 * plugin serves only what the browser half asks for: a single directory tree
 * rooted at the current session's cwd, plus read-only file previews.
 *
 * It registers one self-contained JSON API under `/session-files-api` so the
 * client half never depends on the directory-picker seam composition (which
 * may serve the `native` backend and expose no browse primitives), and it
 * never mutates the filesystem — no write / rename / mkdir operations.
 *
 * The GUI binds to loopback by default (`dsh web`), so this API is only
 * reachable from the operator's own browser. All paths must be fully
 * qualified; listings are capped at 1000 rows, reads at 256 KiB (hard cap
 * 8 MiB).
 */

import { open, opendir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

const name = "session-files";
const inject = ["webServer"];

const MAX_ENTRIES = 1000;
const DEFAULT_READ_BYTES = 256 * 1024;
const MAX_READ_BYTES = 8 * 1024 * 1024;

/** Business failure with a stable wire code. */
class ExplorerError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "ExplorerError";
	}
}

const errorText = (error) => (error instanceof Error ? error.message : String(error));

/** Fully qualified absolute path (drive-qualified on Windows, POSIX-absolute elsewhere). */
function fullyQualified(path) {
	if (typeof path !== "string" || path === "") return false;
	if (!isAbsolute(path)) return false;
	if (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(path) && !/^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(path)) return false;
	return true;
}

function requireQualified(path) {
	if (!fullyQualified(path)) throw new ExplorerError("path-invalid", `"${path}" is not a fully qualified path`);
	return resolve(path);
}

/** Ancestor chain from the filesystem root to `target` inclusive. */
function ancestryCrumbs(target) {
	const crumbs = [];
	let current = target;
	for (;;) {
		const parent = dirname(current);
		crumbs.unshift({
			name: parent === current ? current : basename(current),
			path: current,
			hidden: false,
		});
		if (parent === current) return crumbs;
		current = parent;
	}
}

/** One listing level: directories always (so the browser can drill down), files when asked. */
async function listDirectory(path, includeFiles) {
	const home = homedir();
	const target = requireQualified(path ?? home);
	const entries = [];
	let truncated = false;
	let directory;
	try {
		directory = await opendir(target);
	} catch (error) {
		throw new ExplorerError("directory-unreadable", `cannot list ${target}: ${errorText(error)}`);
	}
	try {
		for (;;) {
			const dirent = await directory.read();
			if (dirent === null) break;
			if (entries.length >= MAX_ENTRIES) {
				truncated = true;
				break;
			}
			const full = join(target, dirent.name);
			const hidden = dirent.name.startsWith(".");
			if (dirent.isDirectory()) {
				entries.push({ name: dirent.name, path: full, hidden, isDirectory: true });
				continue;
			}
			if (dirent.isSymbolicLink()) {
				let kind = null;
				try {
					const info = await stat(full);
					kind = info.isDirectory() ? "dir" : info.isFile() ? "file" : null;
				} catch {
					kind = null;
				}
				if (kind === "dir") entries.push({ name: dirent.name, path: full, hidden, isDirectory: true });
				else if (kind === "file" && includeFiles) {
					try {
						const info = await stat(full);
						entries.push({ name: dirent.name, path: full, hidden, isDirectory: false, size: info.size });
					} catch {
						entries.push({ name: dirent.name, path: full, hidden, isDirectory: false });
					}
				}
				continue;
			}
			if (includeFiles) {
				try {
					const info = await stat(full);
					entries.push({ name: dirent.name, path: full, hidden, isDirectory: false, size: info.size });
				} catch {
					entries.push({ name: dirent.name, path: full, hidden, isDirectory: false });
				}
			}
		}
	} finally {
		await directory.close().catch(() => {});
	}
	entries.sort((left, right) => left.name.localeCompare(right.name));
	return { path: target, home, crumbs: ancestryCrumbs(target), entries, truncated };
}

/** Head text of a UTF-8 file for preview, capped at `maxBytes`. Never loads the whole file. */
async function readFileHead(path, maxBytesOption) {
	const target = requireQualified(path);
	const maxBytes =
		typeof maxBytesOption === "number" &&
		Number.isFinite(maxBytesOption) &&
		maxBytesOption > 0
			? Math.min(Math.floor(maxBytesOption), MAX_READ_BYTES)
			: DEFAULT_READ_BYTES;
	let handle;
	try {
		const info = await stat(target);
		if (!info.isFile()) throw new ExplorerError("file-unreadable", `${target} is not a regular file`);
		handle = await open(target, "r");
		const buffer = Buffer.alloc(Math.min(info.size, maxBytes) + 1);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const truncated = info.size > maxBytes || bytesRead > maxBytes;
		return {
			path: target,
			size: info.size,
			truncated,
			text: buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString("utf8"),
		};
	} catch (error) {
		if (error instanceof ExplorerError) throw error;
		throw new ExplorerError("file-unreadable", `cannot read ${target}: ${errorText(error)}`);
	} finally {
		if (handle !== void 0) await handle.close().catch(() => {});
	}
}

function json(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(body),
	});
	res.end(body);
}

/** The plugin's API route handler (registered under the `/session-files-api` prefix). */
async function handle(req, res) {
	const url = new URL(req.url ?? "/", "http://x");
	const pathname = url.pathname;
	try {
		if (req.method === "GET" && pathname === "/session-files-api/list") {
			return json(
				res,
				200,
				await listDirectory(url.searchParams.get("path"), url.searchParams.get("includeFiles") === "1"),
			);
		}
		if (req.method === "GET" && pathname === "/session-files-api/read") {
			const maxBytes = Number(url.searchParams.get("maxBytes"));
			return json(
				res,
				200,
				await readFileHead(url.searchParams.get("path"), Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : void 0),
			);
		}
		json(res, 404, { code: "not-found", message: "unknown explorer endpoint" });
	} catch (error) {
		if (error instanceof ExplorerError) return json(res, 400, { code: error.code, message: error.message });
		json(res, 500, { code: "internal", message: errorText(error) });
	}
}

async function apply(ctx) {
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: "prefix",
				path: "/session-files-api",
				handler: handle,
			}),
		"session-files: api routes",
	);
}

export { apply, inject, name };
