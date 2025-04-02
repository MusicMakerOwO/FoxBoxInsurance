module.exports = function Cooldown (callback, cooldown = 1000) {
	let lastCalled = 0;
	return function (...args) {
		const now = Date.now();
		if (now - lastCalled >= cooldown) {
			lastCalled = now;
			return callback(...args);
		}
	};
}