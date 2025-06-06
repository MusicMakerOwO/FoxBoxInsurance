const PROGRESS = [' ', '⡀', '⣀', '⣄', '⣤', '⣦', '⣶', '⣷', '⣿'];

module.exports = function ProgressBar(percent = 0) {
	if (percent < 0) percent = 0;
	if (percent > 1) percent = 1;

	const steps = PROGRESS.length - 1;
	const total = percent * steps;
	const full = Math.floor(total);
	const remainder = Math.floor((total - full) * 8);

	let bar = PROGRESS[steps].repeat(full);
	if (full < steps) bar += PROGRESS[remainder];
	bar = bar.padEnd(steps, ' ');

	return `[${bar}] ${Math.floor(percent * 100)}%`;
}