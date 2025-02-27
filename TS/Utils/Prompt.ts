export default async function Prompt(question = ''): Promise<string> {
    if (typeof question !== 'string') throw new Error('Question must be a string');

	process.stdin.resume();

    return new Promise(resolve => {
        const onData = (data: Buffer | string) => {
			data = data.toString().trim();
			process.stdin.off('data', onData);
			process.stdin.pause();
			resolve(data);
        }
        process.stdin.on('data', onData);
		if (question) process.stdout.write(question);
    })
}
