module.exports = function ExcludeProperties (obj, ...properties) {
	const newObj = {};
	for (const key in obj) {
		if (!properties.includes(key)) newObj[key] = obj[key];
	}
	return newObj;
}