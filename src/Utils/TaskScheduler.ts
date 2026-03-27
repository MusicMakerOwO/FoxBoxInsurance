import { Awaitable } from '../Typings/HelperTypes';

export const TaskScheduler = new class {

	taskQueue: Array<{ callback: () => void; time: number; interval: number | null }>;
	timeout: NodeJS.Timeout | null;

    constructor() {
        this.taskQueue = [];
        this.timeout = null;

		// dummy task, this lets you break past the 24.8 days limit on setTimeout()
		this.schedule(() => {}, 2147483647);
    }

    schedule(callback: () => Awaitable<void>, delay: number, interval?: number) {
		if (interval === undefined) interval = delay;

        const task = { callback, time: Date.now() + delay, interval };
        this.taskQueue.push(task);
        this.taskQueue.sort((a, b) => a.time - b.time);
        this.#reschedule();
    }

    #reschedule() {
        if (this.timeout) clearTimeout(this.timeout);

        const nextTask = this.taskQueue[0];
        const timeUntilNext = Math.max(0, nextTask.time - Date.now());

        this.timeout = setTimeout(() => {
			this.#runNextTask();
		}, timeUntilNext);
    }

    #runNextTask() {
        const now = Date.now();
        while (this.taskQueue.length > 0 && this.taskQueue[0].time <= now) {
            const task = this.taskQueue.shift()!;
            task.callback();
            if (task.interval !== null) {
                task.time = now + task.interval;
                this.taskQueue.push(task);
            }
        }
		this.taskQueue.sort((a, b) => a.time - b.time);
        this.#reschedule();
    }

	destroy() {
		if (this.timeout) clearTimeout(this.timeout);
		this.taskQueue = [];
	}
}