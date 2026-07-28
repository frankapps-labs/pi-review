import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerReview from "./index.ts";

const HEADLESS_COMMANDS = new Map([
	["review-fresh-duo", "pi-review-headless-duo"],
	["review-fresh-duo-branch", "pi-review-headless-duo-branch"],
	["review-fresh-duo-staged", "pi-review-headless-duo-staged"],
	["review-verify", "pi-review-headless-verify"],
]);

/**
 * Register automation-only command names without colliding with an installed
 * interactive pi-review extension. The handlers remain the canonical ones.
 */
export default function registerHeadlessReview(pi: ExtensionAPI) {
	const headlessPi = new Proxy(pi, {
		get(target, property) {
			if (property === "registerCommand") {
				return (name: string, options: Parameters<ExtensionAPI["registerCommand"]>[1]) => {
					const headlessName = HEADLESS_COMMANDS.get(name);
					if (headlessName) target.registerCommand(headlessName, options);
				};
			}
			const value = Reflect.get(target, property);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as ExtensionAPI;

	registerReview(headlessPi);
}
