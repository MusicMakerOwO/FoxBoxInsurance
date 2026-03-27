export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type ObjectValues<T extends {}> = T[keyof T];

export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Awaitable<T> = T | Promise<T>;